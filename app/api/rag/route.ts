import { NextRequest, NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';

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
  if (!response.ok) {
    throw new Error(`Hugging Face embedding error: ${response.statusText}`);
  }
  return await response.json();
}

async function streamAnswer(question: string, context: string): Promise<ReadableStream> {
  const truncatedContext = context.slice(0, 1500);
  const prompt = `Answer based ONLY on the context. If uncertain, say "I don't know".

Context: ${truncatedContext}

Question: ${question}

Answer:`;

  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.2,
      max_tokens: 256,
    }),
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transformStream = new ReadableStream({
    async start(controller) {
      const reader = groqResponse.body?.getReader();
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
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            try {
              const json = JSON.parse(dataStr);
              const content = json.choices[0]?.delta?.content;
              if (content) {
                controller.enqueue(encoder.encode(content));
              }
            } catch {
              // ignore parse errors
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

    const results = await collection
      .aggregate([
        {
          $vectorSearch: {
            index: 'vector_index', // must be created with numDimensions: 384
            path: 'embedding',
            queryVector: questionEmbedding,
            numCandidates: 100,
            limit: 4,
          },
        },
        {
          $project: {
            text: 1,
            source: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ])
      .toArray();

    await client.close();

    console.log(`[RAG] Vector search returned ${results.length} results`);

    if (results.length === 0) {
      return NextResponse.json({ answer: 'No relevant documents found.', sources: [] });
    }

    const context = results.map((r) => r.text).join('\n\n');
    console.log(`[RAG] Context length: ${context.length} chars`);

    const stream = await streamAnswer(question, context);
    const sources = results.map((r) => ({
      source: r.source,
      snippet: r.text.slice(0, 200),
    }));

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