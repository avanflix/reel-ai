import { useRef, useState } from "react";

const CATEGORIES = [
  { key: "editing", label: "Editing" },
  { key: "lighting", label: "Lighting" },
  { key: "framing", label: "Framing / Taking" },
  { key: "music_audio", label: "Music / Audio" },
  { key: "hook_engagement", label: "Hook" },
];

export default function Home() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  const inputRef = useRef(null);

  function handleFiles(selected) {
    const arr = Array.from(selected).slice(0, 30);
    setFiles(arr);
    setResults(null);
    setError(null);
  }

  function handleDrop(e) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  function removeFile(index) {
    const updatedFiles = files.filter((_, i) => i !== index);
    setFiles(updatedFiles);

    if (updatedFiles.length === 0) {
      setResults(null);
      setError(null);
    }
  }

  async function handleAnalyse() {
    if (!files.length) return;

    setLoading(true);
    setError(null);
    setResults(null);

    setProgressLabel(
      `Uploading & analysing ${files.length} reel${files.length > 1 ? "s" : ""
      }... this can take a few minutes for large batches.`
    );

    try {
      const formData = new FormData();

      files.forEach((file) => {
        formData.append("reels", file);
      });

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setResults(data.results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgressLabel("");
    }
  }

  function reset() {
    setFiles([]);
    setResults(null);
    setError(null);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <div className="container">
      <h1> Reel Analyser AI</h1>

      <p className="subtitle">
        Upload up to 30 reels. GPT-4o Vision scores each reel on editing,
        lighting, framing, music/audio and hook quality, then ranks every reel.
      </p>

      <div
        className="dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <p>📂 Click or Drag & Drop up to 30 videos</p>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="file-list">
          {files.map((file, index) => (
            <div
              className="file-chip"
              key={`${file.name}-${index}`}
              title={file.name}
            >
              <span className="file-name">{file.name}</span>

              <button
                className="remove-btn"
                disabled={loading}
                onClick={(e) => {
                  e.stopPropagation();

                  if (loading) return;

                  removeFile(index);
                }}
                aria-label="Remove video"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="actions">
        <button
          className="primary"
          disabled={loading || files.length === 0}
          onClick={handleAnalyse}
        >
          {loading
            ? "Analysing..."
            : `Analyse ${files.length || ""} Reel${files.length === 1 ? "" : "s"
            }`}
        </button>

        <button
          className="secondary"
          disabled={loading}
          onClick={reset}
        >
          Clear
        </button>

        {loading && (
          <span className="progress">
            {progressLabel}
          </span>
        )}
      </div>

      {error && (
        <div className="error-box">
          ⚠️ {error}
        </div>
      )}

      {results && (
        <div className="results">
          {results.map((r, index) => (
            <div
              className={`reel-card ${r.error ? "error" : ""}`}
              key={index}
            >
              <div className="reel-header">
                {r.rank && (
                  <div className="rank-badge">
                    #{r.rank}
                  </div>
                )}

                <div className="reel-name">
                  {r.fileName}
                </div>

                {r.analysis && (
                  <div className="overall-score">
                    {r.analysis.overall}/10
                  </div>
                )}
              </div>

              {r.error && (
                <div className="error-box">
                  {r.error}
                </div>
              )}

              {r.verdict && (
                <div className="verdict">
                  {r.verdict}
                </div>
              )}

              {r.analysis && (
                <>
                  <div className="score-grid">
                    {CATEGORIES.map((c) => (
                      <div
                        className="score-item"
                        key={c.key}
                      >
                        <div className="label">
                          {c.label}
                        </div>

                        <div className="value">
                          {r.analysis[c.key]?.score}/10
                        </div>

                        <div className="reason">
                          {r.analysis[c.key]?.reason}
                        </div>
                      </div>
                    ))}
                  </div>

                  {r.analysis.tips?.length > 0 && (
                    <div className="tips">
                      <strong>Tips</strong>

                      <ul>
                        {r.analysis.tips.map((tip, i) => (
                          <li key={i}>{tip}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {r.analysis.summary && (
                    <div className="summary">
                      {r.analysis.summary}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}