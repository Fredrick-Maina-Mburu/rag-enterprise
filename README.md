# 🧠 Enterprise RAG System

A production‑ready Retrieval-Augmented Generation (RAG) system with multi‑user isolation, rate limiting, streaming answers, and automatic document cleanup. Built with Next.js, MongoDB Atlas Vector Search, and Groq.

![RAG Demo](https://via.placeholder.com/800x400?text=RAG+Demo)  

---

## ✨ Features

- **Multi‑format ingestion** – Upload PDF, DOCX, and TXT files; text is extracted, chunked, and embedded.
- **Vector search** – Powered by MongoDB Atlas Vector Search (384‑dim embeddings).
- **LLM integration** – Streams answers from Groq (`llama-3.1-8b-instant`) for low latency.
- **Multi‑user isolation** – Each browser session gets a unique ID; documents are private per user.
- **Rate limiting** – Protects your APIs (default 10 questions/minute per user).
- **Auto‑cleanup** – Documents expire 15 minutes after upload (MongoDB TTL index).
- **Streaming responses** – Answers appear character‑by‑character.
- **Dark modern UI** – Clean, ChatGPT‑like interface with collapsible sidebar.

---

## 🏗️ Architecture

The system consists of:

- A **Next.js** frontend with serverless API routes.
- **MongoDB Atlas** for data storage and vector search.
- **Hugging Face** for generating embeddings (`all-MiniLM-L6-v2`).
- **Groq Cloud** for fast LLM inference (`llama-3.1-8b-instant`).
- A **session‑based user isolation** system using HTTP cookies.

---

## 🛠️ Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** MongoDB Atlas (Vector Search)
- **Embeddings:** Hugging Face Inference (`sentence-transformers/all-MiniLM-L6-v2`)
- **LLM:** Groq (`llama-3.1-8b-instant`)
- **PDF Parsing:** `pdf-parse` (patched)
- **DOCX Parsing:** `mammoth`
- **Text Splitting:** LangChain (`RecursiveCharacterTextSplitter`)
- **Styling:** Custom CSS (dark theme)
- **Deployment:** Vercel (serverless functions)

---

## 📋 Prerequisites

- Node.js 18+ (or 20+)
- pnpm (or npm)
- MongoDB Atlas account (free tier)
- Hugging Face account (for API key)
- Groq Cloud account (for API key)
- Git

---

## 🔧 Local Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/Fredrick-Maina-Mburu/rag-enterprise
cd [your-repo]
```

### 2. Install dependencies

```bash
pnpm install
# or
npm install
```

### 3. Environment variables

Create a `.env.local` file in the project root with:

```env
# MongoDB Atlas
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/
MONGODB_DB_NAME=rag_enterprise

# Hugging Face
HF_API_KEY=hf_xxxxxxxxxxxxxxxxxxxx

# Groq
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx

# Rate limit (optional, default 10)
RATE_LIMIT_PER_MINUTE=10
```

### 4. Set up MongoDB Atlas

- Create a free M0 cluster.
- Create a database named `rag_enterprise`.
- Create a collection named `documents`.
- **Create a Vector Search Index** (Atlas Search → Create Index → JSON Editor). Use the following JSON:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 384, "similarity": "cosine" },
    { "type": "filter", "path": "userId" }
  ]
}
```

- **Create TTL index** for auto‑deletion after 15 minutes (run in `mongosh` or Atlas shell):

```javascript
db.documents.createIndex({ "createdAt": 1 }, { expireAfterSeconds: 900 })
```

- **Create `usage` collection** for rate limiting:

```javascript
db.usage.createIndex({ userId: 1, timestamp: -1 })
db.usage.createIndex({ timestamp: 1 }, { expireAfterSeconds: 86400 })
```

- **Allow network access** – add `0.0.0.0/0` to the IP whitelist (required for Vercel deployment).

### 5. Run the development server

```bash
pnpm dev --webpack   # --webpack avoids Turbopack issues
```

The app will be available at `http://localhost:3000`.

---

## 🚀 Deployment to Vercel

1. Push your code to a GitHub repository.
2. Log in to [Vercel](https://vercel.com) and import the repository.
3. Add the same environment variables (`MONGODB_URI`, `HF_API_KEY`, `GROQ_API_KEY`, `RATE_LIMIT_PER_MINUTE`).
4. Deploy – Vercel will build and host your app.

> **Note:** Ensure your MongoDB Atlas IP whitelist includes `0.0.0.0/0` so Vercel's dynamic IPs can connect.

---

## 📡 API Endpoints

| Endpoint | Method | Headers | Body | Description |
|----------|--------|---------|------|-------------|
| `/api/ingest` | POST | `x-user-id: <string>` | `multipart/form-data` with `file` | Uploads a document, chunks it, embeds, and stores in MongoDB. |
| `/api/rag` | POST | `x-user-id: <string>` | `{ "question": "..." }` | Returns a streaming answer (plain text) with sources in `X-Sources-Base64` header. |
| `/api/documents` | GET | `x-user-id: <string>` | – | Returns list of uploaded document filenames for the user. |

---

## 🧪 Usage

- **Upload documents** – Use the sidebar upload button (supports multiple files).
- **Ask questions** – Type in the chat input and press Enter.
- **View sources** – Each answer shows the source filenames and snippets.
- **Rate limiting** – After 10 questions per minute, you'll receive a `429` error.

---

## 📂 Project Structure

```
.
├── app/
│   ├── api/
│   │   ├── ingest/route.ts          # Document ingestion
│   │   ├── rag/route.ts             # RAG query (streaming)
│   │   └── documents/route.ts       # List user's documents
│   ├── globals.css                  # Global styles (dark theme)
│   ├── layout.tsx                   # Root layout
│   └── page.tsx                     # Main chat UI
├── public/                          # Static assets
├── .env.local                       # Environment variables (not committed)
├── .gitignore
├── package.json
├── README.md
└── tsconfig.json
```

---

## 🧠 Key Implementation Details

- **User isolation** – Each browser gets a random `rag_user_id` cookie. All documents and searches are filtered by `userId`.
- **Embeddings** – Uses `@huggingface/inference` SDK with `sentence-transformers/all-MiniLM-L6-v2` (384 dimensions).
- **Streaming** – Groq’s chat completions API with `stream: true`; raw SSE is parsed and transformed to plain text.
- **Rate limiting** – Counts requests per user in the last 60 seconds; returns `429` if limit exceeded.
- **Auto‑cleanup** – MongoDB TTL index on `createdAt` with `expireAfterSeconds: 900`.

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

**Built with ❤️ as part of an AI/ML portfolio project.**
