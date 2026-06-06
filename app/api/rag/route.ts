import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

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

async function streamAnswer(question: string, context: string): Promise<ReadableStream> {
  const truncatedContext = context.slice(0, 1500);
  const prompt = `Use only the context to answer. If unsure, say "I don't know".

Context:
${truncatedContext}

Question: ${question}

Answer:`;

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'phi3:mini',
      prompt: prompt,
      stream: true,
      options: {
        num_predict: 256,
        temperature: 0.2,
      },
    }),
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transformStream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.response) {
                controller.enqueue(encoder.encode(parsed.response));
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }
      controller.close();
    },
  });

  return transformStream;
}

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();
    if (!question) {
      return NextResponse.json({ error: 'No question provided' }, { status: 400 });
    }

    console.log(`[RAG] Question: "${question}"`);

    const questionEmbedding = await getEmbedding(question);
    console.log(`[RAG] Embedding generated (${questionEmbedding.length} dimensions)`);

    const client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME);
    const collection = db.collection('documents');

    const results = await collection.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: questionEmbedding,
          numCandidates: 100,
          limit: 2,
        },
      },
      {
        $project: {
          text: 1,
          source: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ]).toArray();

    await client.close();

    console.log(`[RAG] Vector search returned ${results.length} results`);

    if (results.length === 0) {
      return NextResponse.json({ answer: 'No relevant documents found.', sources: [] });
    }

    const context = results.map(r => r.text).join('\n\n');
    console.log(`[RAG] Context length: ${context.length} chars`);

    const stream = await streamAnswer(question, context);
    const sources = results.map(r => ({
      source: r.source,
      snippet: r.text.slice(0, 200),
    }));

    // Encode sources as base64 to avoid non-ASCII header issues
    const sourcesBase64 = Buffer.from(JSON.stringify(sources)).toString('base64');

    console.log('[RAG] Generating answer (streaming)...');

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Sources-Base64': sourcesBase64,
      },
    });
  } catch (error: any) {
    console.error('[RAG] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}