'use client';
import { useState, useRef, useEffect } from 'react';

// No import needed

function getUserId(): string {
  // Read cookie
  const name = 'rag_user_id=';
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1);
    if (c.indexOf(name) === 0) return c.substring(name.length, c.length);
  }
  // If not found, create new UUID
  const newId = crypto.randomUUID();
  document.cookie = `rag_user_id=${newId}; path=/; max-age=604800`; // 7 days
  return newId;
}

type Message = {
  role: 'user' | 'assistant';
  content: string;
  sources?: { source: string; snippet: string }[];
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userId = getUserId();
    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({ question: input }),
      });

      const sourcesBase64 = res.headers.get('X-Sources-Base64');
      let sources: { source: string; snippet: string }[] = [];
      if (sourcesBase64) {
        try {
          const decoded = atob(sourcesBase64);
          sources = JSON.parse(decoded);
        } catch (e) {
          console.error('Failed to decode sources', e);
        }
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '', sources }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        fullAnswer += chunk;
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = { role: 'assistant', content: fullAnswer, sources };
          return newMessages;
        });
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + String(err) }]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const userId = getUserId();
    setUploading(true);
    setUploadStatus('Uploading...');
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) {
        errorCount++;
        setUploadStatus(`Uploaded ${successCount} / ${files.length} (errors: ${errorCount})`);
        continue;
      }
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/ingest', { method: 'POST', headers: { 'x-user-id': userId } , body: formData });
        if (res.ok) successCount++;
        else errorCount++;
      } catch {
        errorCount++;
      }
      setUploadStatus(`Uploaded ${successCount} / ${files.length} (errors: ${errorCount})`);
    }
    setUploadStatus(`✅ Done: ${successCount} succeeded, ${errorCount} failed.`);
    setTimeout(() => setUploadStatus(''), 5000);
    setUploading(false);
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
        <div className="sidebar-header" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '◀ Collapse' : '▶'}
        </div>
        {sidebarOpen && (
          <div className="sidebar-content">
            <h2 className="font-semibold">📁 Documents</h2>
            <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
              <label className="cursor-pointer" style={{ display: 'block', backgroundColor: '#2563eb', textAlign: 'center', padding: '0.5rem', borderRadius: '0.5rem' }}>
                {uploading ? 'Uploading...' : '+ Upload Files'}
                <input
                  type="file"
                  multiple
                  accept=".txt,.pdf,.docx"
                  onChange={(e) => handleFileUpload(e.target.files)}
                  style={{ display: 'none' }}
                  disabled={uploading}
                />
              </label>
              {uploadStatus && <div className="text-sm" style={{ color: '#9ca3af', marginTop: '0.5rem' }}>{uploadStatus}</div>}
            </div>
            <div className="text-sm" style={{ color: '#9ca3af' }}>
              <p>Supported: PDF, DOCX, TXT</p>
              <p className="text-xs" style={{ marginTop: '0.5rem' }}>After upload, documents are chunked, embedded, and stored in MongoDB.</p>
            </div>
          </div>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="chat-container">
        <div className="chat-header">
          <h1>📚 Enterprise RAG Assistant</h1>
          <p className="text-sm" style={{ color: '#9ca3af' }}>Ask questions about your uploaded documents</p>
        </div>

        <div className="chat-messages">
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#6b7280', marginTop: '5rem' }}>
              Upload documents in the sidebar, then ask a question.
            </div>
          )}
          {messages.map((msg, idx) => (
            <div key={idx} className={msg.role === 'user' ? 'message-user' : 'message-assistant'}>
              <div className="bubble">
                <div>{msg.content}</div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="sources">
                    <strong>Sources:</strong>
                    <ul>
                      {msg.sources.map((s, i) => (
                        <li key={i}>{s.source} – {s.snippet.slice(0, 80)}...</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="message-assistant">
              <div className="bubble" style={{ fontStyle: 'italic' }}>Thinking...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <textarea
            rows={1}
            placeholder="Ask a question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}