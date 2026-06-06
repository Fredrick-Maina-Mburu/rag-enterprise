import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';   // patched version

async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'nomic-embed-text',
      prompt: text,
    }),
  });
  const data = await response.json();
  return data.embedding;
}

export async function POST(req: NextRequest) {
  try {
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
      chunkSize: 300,
      chunkOverlap: 30,
    });
    const chunks = await splitter.splitDocuments(docs);
    console.log(`[Ingest] Split into ${chunks.length} chunks`);

    const client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME);
    const collection = db.collection('documents');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      const embedding = await getEmbedding(chunk.pageContent);
      await collection.insertOne({
        text: chunk.pageContent,
        embedding,
        source: file.name,
        createdAt: new Date(),
      });
      console.log(`[Ingest] Chunk ${i+1}/${chunks.length} embedded and stored`);
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