
import { useState } from "react";
import Account from "./Account";
import CreateAnimal from "./CreateAnimal";
import TreatmentHistory from "./TreatmentHistory";
import MedicationOrders from "./MedicationOrders";
import { supabase } from "../services/supabaseClient";
import AppointmentManagement from "./AppointmentManagement";
import TestResults from "./TestResults";
import PatientEditForm from "./PatientEditForm";

function Search({ profile, onLogout }) {
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [animal, setAnimal] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState("search");
  const [editingPatient, setEditingPatient] = useState(false);
  const [patientMessage, setPatientMessage] = useState("");

  async function handleSearch(event) {
    event.preventDefault();

    const chipId = search.trim();
    setMessage("");
    setAnimal(null);
    setError("");
    setActiveView("search");

    if (!chipId) {
      setError("Please enter a Chip ID or Global ID.");
      return;
    }

    setLoading(true);

    try {
      const escapedChipId = chipId.replace(/[\\%_]/g, "\\$&");

      const query = supabase.from("animals").select("*");
      const isGlobalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chipId);
      // Separate queries avoid injecting identifiers into a PostgREST OR expression.
      let result = await query.ilike("chip_id", escapedChipId).maybeSingle();
      if (!result.error && !result.data && isGlobalId) {
        result = await supabase.from("animals").select("*").eq("global_id", chipId).maybeSingle();
      }
      const { data, error } = result;

      if (error) throw error;

      if (data) {
        setAnimal(data);
      } else {
        setError(`No animal found with identifier "${chipId}".`);
      }
    } catch {
      setError("Animal records could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function display(value) {
    return value || "Not recorded";
  }

  function goBack() {
    setActiveView("search");
  }

  function renderNavigation() {
    return (
      <nav className="record-navigation" aria-label="Animal record sections">
        <button type="button" onClick={() => setActiveView("record")}>
          Full Record
        </button>
        <button type="button" onClick={() => setActiveView("test-results")}>
          Test Results
        </button>
        <button type="button" onClick={() => setActiveView("appointments")}>
          Appointments
        </button>
        <button type="button" onClick={() => setActiveView("treatment-history")}>
          Treatment History
        </button>
        <button type="button" onClick={() => setActiveView("treatment-notes")}>
          Treatment Notes
        </button>
        <button
          type="button"
          onClick={() => setActiveView("medications")}
        >
          Medications
        </button>
      </nav>
    );
  }

  return (
    <main className="SearchRoot">
      <header className="page-header">
        <div>
          <p className="brand">PAWS</p>
          <h1>Veterinary Patient Records</h1>
          <p className="muted">Animal information and medical history</p>
        </div>

        <nav className="appointment-actions" aria-label="Account navigation">
          <button type="button" className="secondary-button" aria-pressed={!accountOpen} onClick={() => setAccountOpen(false)}>Patient Records</button>
          <button type="button" className="secondary-button" aria-pressed={accountOpen} onClick={() => setAccountOpen(true)}>Account</button>
        <button
          type="button"
          className="secondary-button"
          onClick={onLogout}
        >
          Log Out
        </button>
        </nav>
      </header>

      {accountOpen && <Account profile={profile} onLogout={onLogout} embedded />}
      <div hidden={accountOpen}>
      {creating && <CreateAnimal onCancel={() => setCreating(false)} onCreated={record => {
        setAnimal(record); setSearch(record.chip_id); setActiveView('search'); setCreating(false); setError('');
        setMessage(`Animal created. Global ID: ${record.global_id}`);
      }}/>}
      <div hidden={creating}>
      {message && <p className="success-message" role="status">{message}</p>}
      <section className="search-panel" aria-labelledby="search-heading">
        <h2 id="search-heading">Find a patient</h2>
        <p>Enter the animal's Chip ID or Global ID to access its medical record.</p>

        <p className="auth-links"><button type="button" className="secondary-button" disabled={loading} onClick={() => setCreating(true)}>Create animal</button></p>
        <form className="searchContainer" onSubmit={handleSearch}>
          <div className="search-input-group">
            <label htmlFor="searchBar1">Unique Chip ID or Global ID</label>
            <input
              id="searchBar1"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="For example: 12345_DJ"
              className="searchBar"
              disabled={loading}
            />
          </div>

          <button
            className="searchButton"
            type="submit"
            disabled={loading}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        {loading && <p role="status">Loading patient records...</p>}

        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </section>

      {animal && (
        <>
          {activeView === "search" && (
            <section className="animal-card patient-summary">
              <p className="muted">Patient found</p>
              <h2>{display(animal.name)}</h2>

              <dl className="record-grid">
                <div className="wide-field"><dt>Global ID</dt><dd>{display(animal.global_id)}</dd></div>
                <div>
                  <dt>Chip ID</dt>
                  <dd>{display(animal.chip_id)}</dd>
                </div>
                <div>
                  <dt>Animal type</dt>
                  <dd>{display(animal.animal)}</dd>
                </div>
                <div>
                  <dt>Breed / species</dt>
                  <dd>{display(animal.species)}</dd>
                </div>
                <div>
                  <dt>Age</dt>
                  <dd>{animal.age !== null && animal.age !== undefined && animal.age !== "" ? `${animal.age} years` : "Not recorded"}</dd>
                </div>
              </dl>

              <button
                type="button"
                className="primary-button"
                onClick={() => setActiveView("record")}
              >
                View Full Record
              </button>

              <div className="quick-access">
                <h3>Quick Access</h3>
                <div className="quick-access-grid">
                  <button type="button" onClick={() => setActiveView("test-results")}>
                    Test Results
                  </button>
                  <button type="button" onClick={() => setActiveView("appointments")}>
                    Appointments
                  </button>
                  <button type="button" onClick={() => setActiveView("treatment-history")}>
                    Treatment History
                  </button>
                  <button type="button" onClick={() => setActiveView("treatment-notes")}>
                    Treatment Notes
                  </button>
                  <button type="button" onClick={() => setActiveView("medications")}>
                    Medications
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeView === "record" && (
            <section className="animal-card">
              <button type="button" className="back-button" onClick={goBack}>
                ← Back to Search
              </button>

              <p className="muted">Complete patient record</p>
              <h2>{display(animal.name)}</h2>


          {patientMessage && (
            <p className="success-message" role="status">
              {patientMessage}
            </p>
          )}

          {editingPatient ? (
            <PatientEditForm
              key={animal.chip_id}
              animal={animal}
              onSaved={(updatedAnimal) => {
                setAnimal(updatedAnimal);
                setEditingPatient(false);
                setPatientMessage("Patient information updated successfully.");
              }}
              onCancel={() => setEditingPatient(false)}
            />
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setPatientMessage("");
                setEditingPatient(true);
              }}
            >
              Edit Patient Information
            </button>
          )}


              <dl className="record-grid">
                <div className="wide-field"><dt>Global ID</dt><dd>{display(animal.global_id)}</dd></div>
                <div><dt>Chip ID</dt><dd>{display(animal.chip_id)}</dd></div>
                <div><dt>Animal type</dt><dd>{display(animal.animal)}</dd></div>
                <div><dt>Breed / species</dt><dd>{display(animal.species)}</dd></div>
                <div><dt>Age</dt><dd>{animal.age !== null && animal.age !== undefined && animal.age !== "" ? `${animal.age} years` : "Not recorded"}</dd></div>
                <div>
                  <dt>Sex</dt>
                  <dd>
                    {animal.sex === "F"
                      ? "Female"
                      : animal.sex === "M"
                        ? "Male"
                        : display(animal.sex)}
                  </dd>
                </div>
                <div><dt>Appointment type</dt><dd>{display(animal["appointment type"])}</dd></div>
                <div><dt>Date</dt><dd>{display(animal.date)}</dd></div>
                <div><dt>Diagnosis</dt><dd>{display(animal.diagnosis)}</dd></div>
                <div><dt>Treatment</dt><dd>{display(animal.treatment)}</dd></div>
                <div className="wide-field"><dt>Notes</dt><dd>{display(animal.notes)}</dd></div>
              </dl>

              <h3>Medical Record Sections</h3>
              {renderNavigation()}
            </section>
          )}

          {activeView !== "search" && activeView !== "record" && (
            <section className="animal-card section-view">
              <button type="button" className="back-button" onClick={goBack}>
                ← Back to Full Record
              </button>

              <p className="muted">{display(animal.name)} · {display(animal.chip_id)}</p>

              {renderNavigation()}

              {activeView === "test-results" && (
                <>
                  <h2>Test Results</h2>
                  <TestResults key={animal.chip_id} animal={animal} />
                </>
              )}

              {activeView === "appointments" && (
                <>
                  <h2>Appointments</h2>
                  <AppointmentManagement key={animal.chip_id} animal={animal} />
                </>
              )}

              {activeView === "treatment-history" && (
                <>
                  <h2>Treatment History</h2>
                  <TreatmentHistory key={animal.chip_id} animal={animal} mode="history"/>
                </>
              )}

              {activeView === "treatment-notes" && (
                <>
                  <h2>Treatment Notes</h2>
                  <TreatmentHistory key={animal.chip_id} animal={animal} mode="notes"/>
                </>
              )}

              {activeView === "medications" && (
                <>
                  <h2>Medications</h2>
                  <MedicationOrders key={animal.chip_id} animal={animal} profile={profile} />
                </>
              )}
            </section>
          )}
        </>
      )}
      </div>
      </div>
    </main>
  );
}

export default Search;
