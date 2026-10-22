import { useState } from "react";
import TreatmentHistory from "../pages/TreatmentHistory";
import { supabase } from "../services/supabaseClient";
import AppointmentManagement from "./AppointmentManagement";
import TestResults from "./TestResults";

function Search({ onLogout }) {
  const [search, setSearch] = useState("");
  const [animal, setAnimal] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSearch(event) {
  event.preventDefault();

  const chipId = search.trim();
  setAnimal(null);
  setError("");

  if (!chipId) {
    setError("Please enter a chip ID.");
    return;
  }

  setLoading(true);

  try {
    // Escape characters that have special meaning in ILIKE patterns.
    const escapedChipId = chipId.replace(/[\\%_]/g, "\\$&");

    const { data, error } = await supabase
      .from("animals")
      .select("*")
      .ilike("chip_id", escapedChipId)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      setAnimal(data);
    } else {
      setError(`No animal found with chip ID "${chipId}".`);
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

  return (
    <main className="SearchRoot">
      <header className="page-header">
        <div>
          <p className="brand">PAWS</p>
          <h1>Animal record lookup</h1>
        </div>
        <button type="button" className="secondary-button" onClick={onLogout}>
          Log Out
        </button>
      </header>

      <section className="search-panel" aria-labelledby="search-heading">
        <h2 id="search-heading">Find an animal</h2>
        <form className="searchContainer" onSubmit={handleSearch}>
          <div className="search-input-group">
            <label htmlFor="searchBar1">Chip ID</label>
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
          <button className="searchButton" type="submit" disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </form>
        {loading && <p role="status">Loading animal records...</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>

      {animal && (
        <>
        <section className="animal-card" aria-labelledby="animal-heading" aria-live="polite">
          <p className="muted">Animal record</p>
          <h2 id="animal-heading">{display(animal.name)}</h2>
          <dl className="record-grid">
            <div><dt>Chip ID</dt><dd>{display(animal.chip_id)}</dd></div>
            <div><dt>Animal type</dt><dd>{display(animal.animal)}</dd></div>
            <div><dt>Breed / species</dt><dd>{display(animal.species)}</dd></div>
            <div><dt>Age</dt><dd>{animal.age ? `${animal.age} years` : "Not recorded"}</dd></div>
            <div><dt>Sex</dt><dd>{animal.sex === "F" ? "Female" : animal.sex === "M" ? "Male" : display(animal.sex)}</dd></div>
            <div><dt>Appointment type</dt><dd>{display(animal["appointment type"])}</dd></div>
            <div><dt>Date</dt><dd>{display(animal.date)}</dd></div>
            <div><dt>Diagnosis</dt><dd>{display(animal.diagnosis)}</dd></div>
            <div><dt>Treatment</dt><dd>{display(animal.treatment)}</dd></div>
            <div className="wide-field"><dt>Notes</dt><dd>{display(animal.notes)}</dd></div>
          </dl>
        </section>
        <TreatmentHistory key={animal.chip_id} animal={animal} />
        <AppointmentManagement key={animal.chip_id} animal={animal} />
        <TestResults key={animal.chip_id} animal={animal} />
        </>
      )}
    </main>
  );
}

export default Search;
