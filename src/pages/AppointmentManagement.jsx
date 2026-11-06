
import { useState } from "react";

function readAppointments(key) {
  const saved = localStorage.getItem(key);

  if (saved === null) return [];

  const records = JSON.parse(saved);

  if (!Array.isArray(records)) {
    throw new Error("Invalid saved appointments");
  }

  return records;
}

function displayDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getStatus(record) {
  if (record.status) return record.status;

  const appointmentDate = new Date(`${record.date}T${record.time}`);

  return appointmentDate <= new Date() ? "completed" : "upcoming";
}

function AppointmentManagement({ animal }) {
  const storageKey = `paws:appointments:${animal.chip_id
    .trim()
    .toUpperCase()}`;

  const [history, setHistory] = useState(() => {
    try {
      return {
        records: readAppointments(storageKey),
        error: "",
      };
    } catch {
      return {
        records: [],
        error:
          "Saved appointments could not be loaded. Check browser storage.",
      };
    }
  });

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingCancellation, setPendingCancellation] = useState(null);

  function handleSave(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (history.error) return;

    if (!date || !time || !reason.trim()) {
      setError("Please enter an appointment date, time, and reason.");
      return;
    }

    const appointmentDate = new Date(`${date}T${time}`);

    if (
      Number.isNaN(appointmentDate.getTime()) ||
      appointmentDate <= new Date()
    ) {
      setError("Please choose a valid future appointment date and time.");
      return;
    }

    const cleanReason = reason.trim();

    if (cleanReason.length < 5 || cleanReason.length > 250) {
      setError("Reason for visit must be between 5 and 250 characters.");
      return;
    }

    try {
      const existing = readAppointments(storageKey);

      const duplicate = existing.some(
        (appointment) =>
          appointment.date === date &&
          appointment.time === time &&
          getStatus(appointment) === "upcoming"
      );

      if (duplicate) {
        setError("An appointment already exists at this date and time.");
        return;
      }
    } catch {
      setError("Unable to verify existing appointments. Please try again.");
      return;
    }

    const record = {
      id:
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date,
      time,
      reason: cleanReason,
      status: "upcoming",
    };

    try {
      const updated = [record, ...readAppointments(storageKey)];

      localStorage.setItem(storageKey, JSON.stringify(updated));
      setHistory({ records: updated, error: "" });
      setDate("");
      setTime("");
      setReason("");
      setMessage(
        `Appointment saved for ${animal.name || animal.chip_id}.`
      );
    } catch {
      setError("The appointment could not be saved. Please try again.");
    }
  }

  function updateStatus(record, newStatus, confirmed = false) {
    setError("");
    setMessage("");

    if (history.error) return;

    if (newStatus === "canceled" && !confirmed) {
      setPendingCancellation(record);
      return;
    }

    if (newStatus === "completed") {
      const appointmentDate = new Date(`${record.date}T${record.time}`);

      if (appointmentDate > new Date()) {
        setError("A future appointment cannot be marked as completed.");
        return;
      }
    }

    try {
      const currentRecords = readAppointments(storageKey);
      const exists = currentRecords.some((item) => item.id === record.id);

      if (!exists) {
        setError("This appointment could not be found. Please refresh.");
        return;
      }

      const updated = currentRecords.map((item) =>
        item.id === record.id
          ? { ...item, status: newStatus }
          : item
      );

      localStorage.setItem(storageKey, JSON.stringify(updated));
      setHistory({ records: updated, error: "" });

      if (newStatus === "canceled") {
        setMessage("Appointment canceled successfully.");
      } else {
        setMessage("Appointment marked as completed.");
      }
    } catch {
      setError("The appointment could not be updated. Please try again.");
    }
  }

  function confirmCancellation() {
    if (!pendingCancellation) return;

    const record = pendingCancellation;
    setPendingCancellation(null);
    updateStatus(record, "canceled", true);
  }

  const sortedRecords = [...history.records].sort((a, b) =>
    `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)
  );

  const upcomingAppointments = sortedRecords.filter(
    (record) => getStatus(record) === "upcoming"
  );

  const pastAppointments = sortedRecords.filter((record) =>
    ["completed", "canceled"].includes(getStatus(record))
  );

  return (
    <section
      className="appointment-panel"
      aria-labelledby="appointment-heading"
    >
      <h2 id="appointment-heading">Appointments</h2>

      <p className="muted">
        Schedule an appointment for {animal.name || animal.chip_id} (
        {animal.chip_id}).
      </p>

      {history.error && (
        <p className="error-message" role="alert">
          {history.error}
        </p>
      )}

      <form className="appointment-form" onSubmit={handleSave}>
        <fieldset disabled={Boolean(history.error)}>
          <legend>Schedule an Appointment</legend>

          <label htmlFor="appointment-date">Date</label>
          <input
            id="appointment-date"
            type="date"
            value={date}
            min={new Date().toLocaleDateString("en-CA")}
            onChange={(event) => setDate(event.target.value)}
            required
          />

          <label htmlFor="appointment-time">Time</label>
          <input
            id="appointment-time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
          />

          <label htmlFor="appointment-reason">Reason for Visit</label>
          <input
            id="appointment-reason"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g., Annual checkup"
            required
          />

          <button type="submit">Save Appointment</button>
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

      {pendingCancellation && (
        <div
          className="confirmation-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPendingCancellation(null);
            }
          }}
        >
          <section
            className="confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-dialog-heading"
            aria-describedby="cancel-dialog-description"
          >
            <h3 id="cancel-dialog-heading">Cancel Appointment?</h3>

            <p id="cancel-dialog-description">
              Are you sure you want to cancel{" "}
              <strong>{pendingCancellation.reason}</strong> on{" "}
              {displayDate(pendingCancellation.date)} at{" "}
              {pendingCancellation.time}?
            </p>

            <p className="muted">
              This appointment will remain in your appointment history.
            </p>

            <div className="confirmation-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPendingCancellation(null)}
              >
                Keep Appointment
              </button>

              <button
                type="button"
                className="cancel-confirm-button"
                onClick={confirmCancellation}
              >
                Confirm Cancellation
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="appointment-section">
        <h3>Upcoming Appointments</h3>

        {history.error ? null : upcomingAppointments.length === 0 ? (
          <p>No upcoming appointments.</p>
        ) : (
          <ul className="appointment-list">
            {upcomingAppointments.map((record) => (
              <li key={record.id}>
                <p className="appointment-entry-date">
                  <time dateTime={`${record.date}T${record.time}`}>
                    {displayDate(record.date)} at {record.time}
                  </time>
                </p>

                <h4>{record.reason}</h4>

                <span className="appointment-status status-upcoming">
                  Upcoming
                </span>

                <div className="appointment-actions">
                  <button
                    type="button"
                    className="cancel-appointment-button"
                    onClick={() => updateStatus(record, "canceled")}
                  >
                    Cancel Appointment
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="appointment-section">
        <h3>Appointment History</h3>

        {history.error ? null : pastAppointments.length === 0 ? (
          <p>No appointment history yet.</p>
        ) : (
          <ul className="appointment-list">
            {pastAppointments.map((record) => {
              const status = getStatus(record);

              return (
                <li key={record.id}>
                  <p className="appointment-entry-date">
                    <time dateTime={`${record.date}T${record.time}`}>
                      {displayDate(record.date)} at {record.time}
                    </time>
                  </p>

                  <h4>{record.reason}</h4>

                  <span
                    className={`appointment-status status-${status}`}
                  >
                    {status === "canceled" ? "Canceled" : "Completed"}
                  </span>

                  {status === "completed" && !record.status && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => updateStatus(record, "completed")}
                    >
                      Save as Completed
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default AppointmentManagement;