
import { useEffect, useState } from "react";
import { supabase } from "../services/supabaseClient";

function today() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split("-").map(Number);

  return (
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
  );
}

function displayDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function TreatmentHistory({ animal, mode = "all" }) {
  const chipId = animal.chip_id;

  const [records, setRecords] = useState([]);
  const [date, setDate] = useState(today);
  const [treatment, setTreatment] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const showForm = mode === "notes" || mode === "all";
  const showHistory = mode === "history" || mode === "all";

  useEffect(() => {
    let active = true;

    async function loadTreatments() {
      setLoading(true);
      setLoadError("");

      try {
        const { data, error } = await supabase
          .from("treatments")
          .select("*")
          .eq("chip_id", chipId)
          .order("date", { ascending: false })
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (active) {
          setRecords(data ?? []);
        }
      } catch {
        if (active) {
          setLoadError(
            "Treatments could not be loaded. Please refresh history."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadTreatments();

    return () => {
      active = false;
    };
  }, [chipId, refreshCount]);

  async function handleSave(event) {
    event.preventDefault();

    if (saving || loading || loadError) return;

    setError("");
    setMessage("");

    if (!validDate(date) || !treatment.trim()) {
      setError("Please enter a valid date and a treatment description.");
      return;
    }

    setSaving(true);

    try {
      const { data, error } = await supabase
        .from("treatments")
        .insert({
          chip_id: chipId,
          date,
          treatment: treatment.trim(),
          notes: notes.trim(),
        })
        .select()
        .single();

      if (error) throw error;

      setRecords((previous) =>
        [data, ...previous].sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.created_at.localeCompare(a.created_at)
        )
      );

      setTreatment("");
      setNotes("");
      setDate(today());
      setMessage(`Treatment saved for ${animal.name || chipId}.`);
    } catch {
      setError(
        "The treatment could not be saved. Your form has been kept; please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="treatment-panel" aria-labelledby="treatment-heading">
      {showForm && (
        <>
          <h2 id="treatment-heading">Add Treatment Notes</h2>

          <p className="muted">
            Add a treatment for {animal.name || chipId} ({chipId}).
          </p>

          <form className="treatment-form" onSubmit={handleSave}>
            <fieldset disabled={saving || loading || Boolean(loadError)}>
              <div className="form-group">
                <label htmlFor="treatment-date">Treatment date</label>
                <input
                  id="treatment-date"
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setMessage("");
                  }}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="treatment-description">Treatment</label>
                <input
                  id="treatment-description"
                  type="text"
                  value={treatment}
                  onChange={(event) => {
                    setTreatment(event.target.value);
                    setMessage("");
                  }}
                  placeholder="For example: ear cleaning or vaccination"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="treatment-notes">Notes (optional)</label>
                <textarea
                  id="treatment-notes"
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    setMessage("");
                  }}
                  placeholder="Add observations or follow-up instructions"
                  rows={4}
                />
              </div>

              <button type="submit">
                {saving ? "Saving..." : "Save Treatment"}
              </button>
            </fieldset>
          </form>

          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}

          <p className="success-message" role="status">
            {message}
          </p>
        </>
      )}

      {showHistory && (
        <>
          <h2 id={showForm ? "saved-treatment-heading" : "treatment-heading"}>
            Saved Treatment History
          </h2>

          <p className="muted">
            Previously recorded treatments for {animal.name || chipId}.
          </p>

          <button
            type="button"
            className="secondary-button"
            onClick={() => setRefreshCount((count) => count + 1)}
            disabled={loading || saving}
          >
            {loading ? "Loading..." : "Refresh History"}
          </button>

          {loadError && (
            <p className="error-message" role="alert">
              {loadError}
            </p>
          )}

          {loading ? (
            <p role="status">Loading treatments...</p>
          ) : loadError ? null : records.length === 0 ? (
            <p>No additional treatments saved for this animal.</p>
          ) : (
            <ul className="treatment-list">
              {records.map((record) => (
                <li key={record.id}>
                  <p className="treatment-entry-date">
                    <time dateTime={record.date}>
                      {displayDate(record.date)}
                    </time>
                  </p>

                  <h4>{record.treatment}</h4>

                  <p className="treatment-entry-notes">
                    {record.notes || "No notes added."}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export default TreatmentHistory;
