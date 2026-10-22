
import { useEffect, useState } from "react";

function TestResults({ animal }) {
  const storageKey = `paws:test-results:${animal.chip_id
    .trim()
    .toUpperCase()}`;

  const [results, setResults] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const records = saved ? JSON.parse(saved) : [];

      if (!Array.isArray(records)) {
        throw new Error("Invalid saved results");
      }

      setResults(records);
    } catch {
      setResults([]);
      setError("Saved test results could not be loaded.");
    }

    setSelectedFile(null);
    setPreview("");
  }, [storageKey]);

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    setError("");
    setMessage("");
    setSelectedFile(null);
    setPreview("");

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      event.target.value = "";
      return;
    }

    if (file.size > 1024 * 1024) {
      setError("Please choose an image smaller than 1 MB.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSelectedFile(file);
        setPreview(reader.result);
      } else {
        setError("The image could not be previewed.");
      }
    };

    reader.onerror = () => {
      setError("The image could not be read. Please try again.");
    };

    reader.readAsDataURL(file);
  }

  function handleUpload(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!selectedFile || !preview) {
      setError("Please select an image first.");
      return;
    }

    const newResult = {
      id:
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName: selectedFile.name,
      image: preview,
      uploadedAt: new Date().toISOString(),
    };

    try {
      const updated = [newResult, ...results];

      localStorage.setItem(storageKey, JSON.stringify(updated));
      setResults(updated);
      setSelectedFile(null);
      setPreview("");
      setMessage("Test result uploaded successfully.");

      const fileInput = document.getElementById("test-result-image");
      if (fileInput) fileInput.value = "";
    } catch {
      setError(
        "The image could not be saved. Try a smaller image or remove older results."
      );
    }
  }

  function handleDelete(resultId) {
    const updated = results.filter((result) => result.id !== resultId);

    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
      setResults(updated);
      setMessage("Test result removed.");
      setError("");
    } catch {
      setError("The test result could not be removed.");
    }
  }

  return (
    <section className="test-results-panel" aria-labelledby="test-results-heading">
      <h2 id="test-results-heading">Test Results</h2>

      <p className="muted">
        Upload and view image results for{" "}
        {animal.name || animal.chip_id} ({animal.chip_id}).
      </p>

      <form className="test-results-form" onSubmit={handleUpload}>
        <label htmlFor="test-result-image">
          Select a test result image
        </label>

        <input
          id="test-result-image"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />

        <p className="muted">Image files only, up to 1 MB each.</p>

        {preview && (
          <div className="test-result-preview">
            <p>Image preview</p>
            <img src={preview} alt="Preview of selected test result" />
            <p>{selectedFile?.name}</p>
          </div>
        )}

        <button type="submit" disabled={!selectedFile || !preview}>
          Upload Test Result
        </button>
      </form>

      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}

      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}

      <div className="test-results-gallery">
        <h3>Saved Test Results</h3>

        {results.length === 0 ? (
          <p>No test result images uploaded for this animal yet.</p>
        ) : (
          <div className="test-results-grid">
            {results.map((result) => (
              <article className="test-result-card" key={result.id}>
                <a
                  href={result.image}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`View full image: ${result.fileName}`}
                >
                  <img
                    src={result.image}
                    alt={`Test result: ${result.fileName}`}
                  />
                </a>

                <h4>{result.fileName}</h4>

                <p className="muted">
                  Uploaded{" "}
                  {new Date(result.uploadedAt).toLocaleString()}
                </p>

                <a
                  href={result.image}
                  target="_blank"
                  rel="noreferrer"
                >
                  View full image
                </a>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleDelete(result.id)}
                >
                  Remove Result
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default TestResults;