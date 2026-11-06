
import { useEffect, useState } from "react";
import { supabase } from "../services/supabaseClient";

const statusLabels = {
  requested: "Requested",
  in_progress: "In Progress",
  completed: "Completed",
  unable_to_complete: "Unable to Complete",
};

export default function DiagnosticQueue({ centerId }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const [reasons, setReasons] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadRequests() {
      try {
        const { data, error: fetchError } = await supabase
          .from("diagnostic_requests")
          .select(
            "id, animal_global_id, test_name, instructions, status, unable_reason, created_at, updated_at"
          )
          .eq("assigned_center_id", centerId)
          .order("created_at", { ascending: false });

        if (!active) return;

        if (fetchError) throw fetchError;

        setRequests(data ?? []);
        setError("");
      } catch {
        if (active) {
          setError("Unable to load diagnostic requests.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadRequests();

    return () => {
      active = false;
    };
  }, [centerId, refreshKey]);

  function refreshQueue() {
    setLoading(true);
    setError("");
    setMessage("");
    setRefreshKey((value) => value + 1);
  }

  async function updateStatus(request, nextStatus) {
    if (pendingId) return;

    setError("");
    setMessage("");

    const reason = (reasons[request.id] ?? "").trim();

    if (
      nextStatus === "unable_to_complete" &&
      (reason.length < 5 || reason.length > 1000)
    ) {
      setError(
        "Please provide a reason between 5 and 1000 characters."
      );
      return;
    }

    setPendingId(request.id);

    try {
      const { data, error: updateError } = await supabase.rpc(
        "update_diagnostic_request",
        {
          request_id: request.id,
          next_status: nextStatus,
          reason:
            nextStatus === "unable_to_complete" ? reason : null,
        }
      );

      if (updateError) throw updateError;
      if (!data) throw new Error("No updated request returned");

      setRequests((previous) =>
        previous.map((item) =>
          item.id === request.id ? data : item
        )
      );

      setMessage("Diagnostic request updated successfully.");
    } catch {
      setError(
        "Could not update the diagnostic request. Refresh and try again."
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section
      className="search-panel"
      aria-labelledby="diagnostic-queue-heading"
    >
      <h2 id="diagnostic-queue-heading">
        Diagnostic Center Queue
      </h2>

      <p className="muted">
        Requests assigned to your diagnostic center.
      </p>

      <button
        type="button"
        className="secondary-button"
        onClick={refreshQueue}
        disabled={loading || Boolean(pendingId)}
      >
        Refresh Queue
      </button>

      {loading && <p role="status">Loading requests...</p>}

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

      {!loading && !error && requests.length === 0 && (
        <p>No diagnostic requests assigned to your center.</p>
      )}

      {!loading && requests.map((request) => {
        const isActive =
          request.status === "requested" ||
          request.status === "in_progress";

        const isSaving = pendingId === request.id;

        return (
          <article
            className="treatment-panel"
            key={request.id}
          >
            <h3>{request.test_name}</h3>

            <p>
              <strong>Animal ID:</strong>{" "}
              {request.animal_global_id}
            </p>

            <p>
              <strong>Instructions:</strong>{" "}
              {request.instructions || "None"}
            </p>

            <p>
              <strong>Requested:</strong>{" "}
              {new Date(request.created_at).toLocaleString()}
            </p>

            <p>
              <strong>Status:</strong>{" "}
              {statusLabels[request.status] ?? request.status}
            </p>

            {request.unable_reason && (
              <p>
                <strong>Unable to complete reason:</strong>{" "}
                {request.unable_reason}
              </p>
            )}

            {isActive && (
              <div className="appointment-actions">
                {request.status === "requested" && (
                  <button
                    type="button"
                    disabled={Boolean(pendingId)}
                    onClick={() =>
                      updateStatus(request, "in_progress")
                    }
                  >
                    {isSaving ? "Saving..." : "Start Request"}
                  </button>
                )}

                {request.status === "in_progress" && (
                  <button
                    type="button"
                    disabled={Boolean(pendingId)}
                    onClick={() =>
                      updateStatus(request, "completed")
                    }
                  >
                    {isSaving ? "Saving..." : "Mark Completed"}
                  </button>
                )}

                <div className="form-group">
                  <label htmlFor={`unable-reason-${request.id}`}>
                    Reason if unable to complete
                  </label>

                  <textarea
                    id={`unable-reason-${request.id}`}
                    value={reasons[request.id] ?? ""}
                    onChange={(event) =>
                      setReasons((previous) => ({
                        ...previous,
                        [request.id]: event.target.value,
                      }))
                    }
                    rows={2}
                    maxLength={1000}
                    disabled={Boolean(pendingId)}
                    placeholder="Explain why the test cannot be completed"
                  />

                  <button
                    type="button"
                    disabled={Boolean(pendingId)}
                    onClick={() =>
                      updateStatus(request, "unable_to_complete")
                    }
                  >
                    Unable to Complete
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
