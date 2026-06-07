import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(
    'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
    }
  );
  if (!response.ok) throw new Error(`Hugging Face error: ${response.statusText}`);
  return await response.json();
}

export async function POST(req: NextRequest) {
  try {
    // Lazy load heavy libraries only when the API is called (not during build)
    const pdfParse = (await import('pdf-parse')).default;
    const mammoth = await import('mammoth');

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    console.log(`[Ingest] Starting: ${file.name} (${(buffer.length / 1024).toFixed(2)} KB)`);

    let text: string;
    if (file.name.endsWith('.txt')) {
      text = await file.text();
    } else if (file.name.endsWith('.pdf')) {
      const pdfData = await pdfParse(buffer);
      text = pdfData.text;
    } else if (file.name.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    console.log(`[Ingest] Extracted ${text.length} characters`);

    const docs = [{ pageContent: text, metadata: { source: file.name } }];
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50,
    });
    const chunks = await splitter.splitDocuments(docs);
    console.log(`[Ingest] Split into ${chunks.length} chunks`);

    const client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME);
    const collection = db.collection('documents');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await getEmbedding(chunk.pageContent);
      await collection.insertOne({
        text: chunk.pageContent,
        embedding,
        source: file.name,
        createdAt: new Date(),
      });
      console.log(`[Ingest] Chunk ${i + 1}/${chunks.length} embedded and stored`);
    }

    await client.close();
    console.log(`[Ingest] Completed: ${file.name}`);
    return NextResponse.json({
      success: true,
      chunksInserted: chunks.length,
      message: `Ingested ${chunks.length} chunks from ${file.name}`,
    });
  } catch (error: any) {
    console.error('[Ingest] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}