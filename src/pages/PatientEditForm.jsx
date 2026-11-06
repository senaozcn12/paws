
import { useState } from "react";
import { supabase } from "../services/supabaseClient";

// The Global ID and Chip ID cannot be changed through this form.
export default function PatientEditForm({ animal, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: animal.name ?? "",
    animal: animal.animal ?? "",
    species: animal.species ?? "",
    age: animal.age == null ? "" : String(animal.age),
    sex: animal.sex ?? "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const change = (field) => (event) => {
    setForm((previous) => ({
      ...previous,
      [field]: event.target.value,
    }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;

    setError("");

    const name = form.name.trim();
    const animalType = form.animal.trim();
    const species = form.species.trim();
    const age = form.age.trim();

    // Validate required fields.
    if (!name || !animalType || !species) {
      setError("Name, animal type, and breed/species are required.");
      return;
    }

    // Validate text lengths.
    if ([name, animalType, species].some((value) => value.length > 100)) {
      setError("Text fields must be 100 characters or fewer.");
      return;
    }

    // Validate age.
    if (age && (!/^\d+$/.test(age) || Number(age) > 150)) {
      setError("Age must be a whole number between 0 and 150.");
      return;
    }

    // Make sure the patient has a permanent Global ID.
    if (!animal.global_id) {
      setError(
        "This patient is missing a Global ID. Please refresh the record."
      );
      return;
    }

    // Prepare the values to be saved.
    const changes = {
      name,
      animal: animalType,
      species,
      age: age === "" ? null : Number(age),
      sex: form.sex || null,
    };

    // Only update fields that have actually changed.
    const changedFields = Object.fromEntries(
      Object.entries(changes).filter(([field, value]) => {
        const original = animal[field] ?? null;

        // Age may be stored as text or a number in Supabase.
        if (field === "age") {
          return (
            (value === null ? null : String(value)) !==
            (original === null ? null : String(original))
          );
        }

        return value !== original;
      })
    );

    // If nothing changed, close the form without saving.
    if (Object.keys(changedFields).length === 0) {
      onCancel();
      return;
    }

    setSaving(true);

    try {
      const { data, error: updateError } = await supabase
        .from("animals")
        .update(changedFields)
        .eq("global_id", animal.global_id)
        .select("*")
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }

      if (!data) {
        setError(
          "Record could not be updated. Check your permissions or refresh."
        );
        return;
      }

      // Update the patient information displayed on the page.
      onSaved(data);
    } catch {
      setError(
        "Unable to save patient information. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="patient-edit-form"
      onSubmit={handleSubmit}
    >
      <h3>Edit Patient Information</h3>

      <p className="muted">
        Global ID: {animal.global_id || "Not available"}
      </p>

      <p className="muted">
        Chip ID: {animal.chip_id} (cannot be changed here)
      </p>

      <fieldset disabled={saving}>
        <label htmlFor="edit-patient-name">
          Name
        </label>
        <input
          id="edit-patient-name"
          type="text"
          value={form.name}
          onChange={change("name")}
          maxLength={100}
          required
        />

        <label htmlFor="edit-patient-type">
          Animal type
        </label>
        <input
          id="edit-patient-type"
          type="text"
          value={form.animal}
          onChange={change("animal")}
          maxLength={100}
          required
        />

        <label htmlFor="edit-patient-species">
          Breed / species
        </label>
        <input
          id="edit-patient-species"
          type="text"
          value={form.species}
          onChange={change("species")}
          maxLength={100}
          required
        />

        <label htmlFor="edit-patient-age">
          Age (years)
        </label>
        <input
          id="edit-patient-age"
          type="number"
          min="0"
          max="150"
          step="1"
          value={form.age}
          onChange={change("age")}
        />

        <label htmlFor="edit-patient-sex">
          Sex
        </label>
        <select
          id="edit-patient-sex"
          value={form.sex}
          onChange={change("sex")}
        >
          <option value="">Not recorded</option>
          <option value="F">Female</option>
          <option value="M">Male</option>
          <option value="U">Unknown</option>
        </select>

        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}

        <div className="appointment-actions">
          <button
            type="submit"
            className="primary-button"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
