"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Button, Modal, Input, Select } from "@/components/ui";
import { MultiSelect } from "@/components/ui/MultiSelect";


const EVENT_TYPE_OPTIONS = [
  { value: "community_field_mapping", label: "Community Field Mapping" },
  { value: "conference", label: "Conference" },
  { value: "mapping_party", label: "Mapping Party" },
  { value: "meetup_networking", label: "Meetup / Networking Event" },
  { value: "multi_activity_event", label: "Multi-Activity Event" },
  { value: "other", label: "Other" },
  { value: "presentation", label: "Presentation" },
  { value: "themed_mapathon", label: "Themed Mapathon" },
  { value: "training_workshop", label: "Training Workshop" },
  { value: "university_engagement", label: "University Engagement" },
];

const EVENT_FORMAT_OPTIONS = [
  { value: "field_based", label: "Field-based" },
  { value: "hybrid", label: "Hybrid" },
  { value: "in_person", label: "In-person" },
  { value: "remote", label: "Remote" },
];

const TRANSPORT_METHOD_OPTIONS = [
  { value: "bus", label: "Bus" },
  { value: "motorcycle", label: "Motorcycle" },
  { value: "other", label: "Other" },
  { value: "personal_vehicle", label: "Personal vehicle" },
  { value: "rental_vehicle", label: "Rental vehicle" },
  { value: "taxi", label: "Taxi" },
  { value: "train", label: "Train" },
];

const ADDITIONAL_TRAVEL_OPTIONS = [
  { value: "parking", label: "Parking" },
  { value: "public_transit", label: "Public transit" },
  { value: "tolls", label: "Tolls" },
  { value: "vehicle_rental", label: "Vehicle rental" },
];

const BUDGET_CATEGORY_OPTIONS = [
  { value: "accommodation", label: "Accommodation" },
  { value: "equipment", label: "Equipment / Supplies" },
  { value: "food", label: "Food & Refreshments" },
  { value: "fuel", label: "Fuel / Transportation Costs" },
  { value: "mobile_data", label: "Mobile Data / Internet" },
  { value: "printing", label: "Printing / Promotional Materials" },
  { value: "venue", label: "Venue Costs" },
];

const PAGE_TITLES = [
  "Basic Event Information",
  "Participation & Community Impact",
  "Travel & Field Activity",
  "Budget & Reimbursement",
  "Agreement & Commitment",
  "Supporting Documents & Notes",
];

const TOTAL_PAGES = 6;

// ── Types ──────────────────────────────────────────────────────────────────

interface ApiCountry {
  id: number;
  name: string;
  iso_code: string | null;
  region_id: number | null;
  region_name: string | null;
}

interface FormData {
  title: string;
  coOrganizers: string;
  eventType: string;
  eventFormat: string;
  startDate: string;
  endDate: string;
  country: string;
  cityRegion: string;
  venueName: string;
  description: string;
  attendees: string;
  externalOrgs: string;
  expectedOutcomes: string;
  needsTravel: string;
  numTravelers: string;
  transportMethod: string;
  originCity: string;
  originCountry: string;
  destinationCity: string;
  destinationCountry: string;
  estimatedTransportCost: string;
  additionalTravelExpenses: string[];
  currency: string;
  selectedBudgetCategories: string[];
  budgetAmounts: Record<string, string>;
  otherExpenseAmount: string;
  otherExpenseExplanation: string;
  costJustification: string;
  agreesToReport: boolean;
  supportingFiles: File[];
  additionalNotes: string;
}

const INITIAL_FORM: FormData = {
  title: "",
  coOrganizers: "",
  eventType: "",
  eventFormat: "",
  startDate: "",
  endDate: "",
  country: "",
  cityRegion: "",
  venueName: "",
  description: "",
  attendees: "",
  externalOrgs: "",
  expectedOutcomes: "",
  needsTravel: "",
  numTravelers: "1",
  transportMethod: "",
  originCity: "",
  originCountry: "",
  destinationCity: "",
  destinationCountry: "",
  estimatedTransportCost: "",
  additionalTravelExpenses: [],
  currency: "",
  selectedBudgetCategories: [],
  budgetAmounts: {},
  otherExpenseAmount: "",
  otherExpenseExplanation: "",
  costJustification: "",
  agreesToReport: false,
  supportingFiles: [],
  additionalNotes: "",
};

// ── Shared sub-components ─────────────────────────────────────────────────

function FieldLabel({
  label,
  required,
  optional,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-foreground">
      {label}
      {required && <span className="ml-1 text-destructive">*</span>}
      {optional && (
        <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
      )}
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-destructive">{message}</p>;
}

const textareaClass = (hasError: boolean) =>
  `flex w-full rounded-lg border ${
    hasError ? "border-destructive" : "border-input"
  } bg-background px-3.5 py-2.5 text-[15px] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none`;

const dateInputClass = (hasError: boolean) =>
  `flex h-[42px] w-full rounded-lg border ${
    hasError ? "border-destructive" : "border-input"
  } bg-background px-3.5 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`;

// ── Main component ─────────────────────────────────────────────────────────

interface CreateEventProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function CreateEventProposalModal({
  isOpen,
  onClose,
  onSubmitted,
}: CreateEventProposalModalProps) {
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiCountries, setApiCountries] = useState<ApiCountry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch countries from API once on mount
  useEffect(() => {
    fetch("/backend/region/list_countries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 200 && data.countries) {
          setApiCountries(data.countries);
        }
      })
      .catch(console.error);
  }, []);

  // Default country to the user's assigned country when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    fetch("/backend/user/fetch_user_profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 200 && data.country_id != null) {
          setForm((prev) =>
            prev.country ? prev : { ...prev, country: String(data.country_id) },
          );
        }
      })
      .catch(console.error);
  }, [isOpen]);

  const countryOptions = useMemo(
    () => apiCountries.map((c) => ({ value: String(c.id), label: c.name })),
    [apiCountries],
  );

  const set = useCallback(
    <K extends keyof FormData>(key: K, val: FormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: val }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    },
    [],
  );


  const totalReimbursement = useMemo(() => {
    const budgetTotal = form.selectedBudgetCategories.reduce((sum, cat) => {
      const n = parseFloat(form.budgetAmounts[cat] || "0");
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
    const other = parseFloat(form.otherExpenseAmount || "0");
    return budgetTotal + (isNaN(other) ? 0 : other);
  }, [form.selectedBudgetCategories, form.budgetAmounts, form.otherExpenseAmount]);

  const validatePage = useCallback(
    (p: number): boolean => {
      const e: Record<string, string> = {};

      if (p === 1) {
        if (!form.title.trim()) e.title = "Required";
        if (!form.eventType) e.eventType = "Required";
        if (!form.eventFormat) e.eventFormat = "Required";
        if (!form.startDate) e.startDate = "Required";
        if (!form.endDate) e.endDate = "Required";
        if (form.startDate && form.endDate && form.endDate < form.startDate)
          e.endDate = "End date must be after start date";
        if (!form.country) e.country = "Required";
        if (!form.cityRegion.trim()) e.cityRegion = "Required";
        if (!form.venueName.trim()) e.venueName = "Required";
        if (!form.description.trim()) e.description = "Required";
      }

      if (p === 2) {
        if (!form.attendees || parseInt(form.attendees) < 1)
          e.attendees = "Required";
        if (!form.expectedOutcomes.trim()) e.expectedOutcomes = "Required";
      }

      if (p === 3) {
        if (!form.needsTravel) e.needsTravel = "Required";
        if (form.needsTravel === "yes") {
          if (!form.numTravelers || parseInt(form.numTravelers) < 1)
            e.numTravelers = "Required";
          if (!form.transportMethod) e.transportMethod = "Required";
          if (!form.originCity.trim()) e.originCity = "Required";
          if (!form.originCountry) e.originCountry = "Required";
          if (!form.destinationCity.trim()) e.destinationCity = "Required";
          if (!form.destinationCountry) e.destinationCountry = "Required";
          if (!form.estimatedTransportCost.trim())
            e.estimatedTransportCost = "Required";
        }
      }

      if (p === 4) {
        if (!form.currency) e.currency = "Required";
        if (!form.costJustification.trim()) e.costJustification = "Required";
      }

      if (p === 5) {
        if (!form.agreesToReport)
          e.agreesToReport =
            "You must agree to submit a post-event report to proceed.";
      }

      setErrors(e);
      return Object.keys(e).length === 0;
    },
    [form],
  );

  const handleNext = useCallback(() => {
    if (validatePage(page)) setPage((p) => p + 1);
  }, [page, validatePage]);

  const handleBack = useCallback(() => {
    setErrors({});
    setPage((p) => p - 1);
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!validatePage(page)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Upload supporting files to DO Spaces and collect object keys.
      const attachmentKeys: string[] = [];
      for (const file of form.supportingFiles) {
        const contentType = file.type || "application/octet-stream";
        const urlRes = await fetch("/backend/event/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, content_type: contentType }),
        });
        const urlData = await urlRes.json();
        if (urlData.status !== 200) {
          setSubmitError(`Failed to get upload URL for "${file.name}".`);
          return;
        }
        const putRes = await fetch(urlData.url, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!putRes.ok) {
          setSubmitError(`Failed to upload "${file.name}".`);
          return;
        }
        attachmentKeys.push(urlData.key);
      }

      const res = await fetch("/backend/event/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          coOrganizers: form.coOrganizers,
          eventType: form.eventType,
          eventFormat: form.eventFormat,
          startDate: form.startDate,
          endDate: form.endDate,
          country: form.country,
          cityRegion: form.cityRegion,
          venueName: form.venueName,
          description: form.description,
          attendees: form.attendees,
          externalOrgs: form.externalOrgs,
          expectedOutcomes: form.expectedOutcomes,
          needsTravel: form.needsTravel,
          numTravelers: form.numTravelers,
          transportMethod: form.transportMethod,
          originCity: form.originCity,
          originCountry: form.originCountry,
          destinationCity: form.destinationCity,
          destinationCountry: form.destinationCountry,
          estimatedTransportCost: form.estimatedTransportCost,
          additionalTravelExpenses: form.additionalTravelExpenses,
          currency: form.currency,
          selectedBudgetCategories: form.selectedBudgetCategories,
          budgetAmounts: form.budgetAmounts,
          otherExpenseAmount: form.otherExpenseAmount,
          otherExpenseExplanation: form.otherExpenseExplanation,
          costJustification: form.costJustification,
          agreesToReport: form.agreesToReport,
          additionalNotes: form.additionalNotes,
          attachmentKeys,
        }),
      });
      const data = await res.json();
      if (data.status !== 200) {
        setSubmitError(data.message || "Submission failed. Please try again.");
        return;
      }
      onSubmitted?.();
      onClose();
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [form, page, validatePage, onSubmitted, onClose]);

  const handleClose = useCallback(() => {
    setPage(1);
    setForm(INITIAL_FORM);
    setErrors({});
    onClose();
  }, [onClose]);

  // ── Page renderers ───────────────────────────────────────────────────────

  const renderPage1 = () => (
    <div className="space-y-4">
      <Input
        label="Event Title *"
        value={form.title}
        onChange={(e) => set("title", e.target.value)}
        placeholder="Enter event title"
        error={errors.title}
      />
      <Input
        label="Co-Organizers"
        value={form.coOrganizers}
        onChange={(e) => set("coOrganizers", e.target.value)}
        placeholder="OSM usernames, comma-separated (optional)"
      />
      <Select
        label="Event Type *"
        options={EVENT_TYPE_OPTIONS}
        value={form.eventType}
        onChange={(val) => set("eventType", val)}
        placeholder="Select event type"
        searchable
        error={errors.eventType}
      />
      <Select
        label="Event Format *"
        options={EVENT_FORMAT_OPTIONS}
        value={form.eventFormat}
        onChange={(val) => set("eventFormat", val)}
        placeholder="Select event format"
        error={errors.eventFormat}
      />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel label="Start Date" required />
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => set("startDate", e.target.value)}
            className={dateInputClass(!!errors.startDate)}
          />
          <FieldError message={errors.startDate} />
        </div>
        <div>
          <FieldLabel label="End Date" required />
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => set("endDate", e.target.value)}
            className={dateInputClass(!!errors.endDate)}
          />
          <FieldError message={errors.endDate} />
        </div>
      </div>
      <Select
        label="Country *"
        options={countryOptions}
        value={form.country}
        onChange={(val) => set("country", val)}
        placeholder="Select country"
        searchable
        error={errors.country}
      />
      <Input
        label="City / Region *"
        value={form.cityRegion}
        onChange={(e) => set("cityRegion", e.target.value)}
        placeholder="City or region"
        error={errors.cityRegion}
      />
      <Input
        label="Venue / Location Name *"
        value={form.venueName}
        onChange={(e) => set("venueName", e.target.value)}
        placeholder="Venue or location name"
        error={errors.venueName}
      />
      <div>
        <FieldLabel label="Event Description" required />
        <textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Describe the event..."
          rows={4}
          className={textareaClass(!!errors.description)}
        />
        <FieldError message={errors.description} />
      </div>
    </div>
  );

  const renderPage2 = () => (
    <div className="space-y-4">
      <Input
        label="Estimated Number of Attendees *"
        type="number"
        min={1}
        value={form.attendees}
        onChange={(e) => set("attendees", e.target.value)}
        placeholder="e.g. 25"
        error={errors.attendees}
      />
      <Input
        label="External Organizations or Partners Involved"
        value={form.externalOrgs}
        onChange={(e) => set("externalOrgs", e.target.value)}
        placeholder="Optional"
      />
      <div>
        <FieldLabel label="Expected Outcomes" required />
        <textarea
          value={form.expectedOutcomes}
          onChange={(e) => set("expectedOutcomes", e.target.value)}
          placeholder="Describe expected results and community impact..."
          rows={5}
          className={textareaClass(!!errors.expectedOutcomes)}
        />
        <FieldError message={errors.expectedOutcomes} />
      </div>
    </div>
  );

  const renderPage3 = () => (
    <div className="space-y-4">
      <Select
        label="Will you need to travel for this event? *"
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        value={form.needsTravel}
        onChange={(val) => set("needsTravel", val)}
        placeholder="Select"
        error={errors.needsTravel}
      />

      {form.needsTravel === "no" && (
        <p className="rounded-lg border border-input bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No travel required — click Next to continue to the budget section.
        </p>
      )}

      {form.needsTravel === "yes" && (
        <>
          <Input
            label="Number of Travelers *"
            type="number"
            min={1}
            value={form.numTravelers}
            onChange={(e) => set("numTravelers", e.target.value)}
            error={errors.numTravelers}
          />
          <Select
            label="Transportation Method *"
            options={TRANSPORT_METHOD_OPTIONS}
            value={form.transportMethod}
            onChange={(val) => set("transportMethod", val)}
            placeholder="Select transportation method"
            error={errors.transportMethod}
          />
          <div>
            <FieldLabel label="Origin" required />
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={form.originCity}
                onChange={(e) => set("originCity", e.target.value)}
                placeholder="City"
                error={errors.originCity}
              />
              <Select
                options={countryOptions}
                value={form.originCountry}
                onChange={(val) => set("originCountry", val)}
                placeholder="Country"
                searchable
                error={errors.originCountry}
              />
            </div>
          </div>
          <div>
            <FieldLabel label="Destination" required />
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={form.destinationCity}
                onChange={(e) => set("destinationCity", e.target.value)}
                placeholder="City"
                error={errors.destinationCity}
              />
              <Select
                options={countryOptions}
                value={form.destinationCountry}
                onChange={(val) => set("destinationCountry", val)}
                placeholder="Country"
                searchable
                error={errors.destinationCountry}
              />
            </div>
          </div>
          <Input
            label="Estimated Fuel / Transportation Cost *"
            value={form.estimatedTransportCost}
            onChange={(e) => set("estimatedTransportCost", e.target.value)}
            placeholder="e.g. 50.00"
            error={errors.estimatedTransportCost}
          />
          <div>
            <FieldLabel label="Additional Travel Expenses" optional />
            <MultiSelect
              options={ADDITIONAL_TRAVEL_OPTIONS}
              value={form.additionalTravelExpenses}
              onChange={(val) => set("additionalTravelExpenses", val)}
              placeholder="Select additional expense types"
            />
          </div>
        </>
      )}
    </div>
  );

  const renderPage4 = () => (
    <div className="space-y-4">
      <Input
        label="Currency *"
        value={form.currency}
        onChange={(e) => set("currency", e.target.value)}
        placeholder="e.g. USD, EUR, KES"
        error={errors.currency}
      />

      <div>
        <FieldLabel label="Budget Breakdown" />
        <MultiSelect
          options={BUDGET_CATEGORY_OPTIONS}
          value={form.selectedBudgetCategories}
          onChange={(val) => set("selectedBudgetCategories", val)}
          placeholder="Select expense categories"
        />
        {form.selectedBudgetCategories.length > 0 && (
          <div className="mt-3 space-y-2 rounded-lg border border-input bg-muted/20 p-3">
            {form.selectedBudgetCategories.map((cat) => {
              const opt = BUDGET_CATEGORY_OPTIONS.find((o) => o.value === cat);
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className="w-52 shrink-0 text-sm text-foreground">
                    {opt?.label}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.budgetAmounts[cat] ?? ""}
                    onChange={(e) =>
                      set("budgetAmounts", {
                        ...form.budgetAmounts,
                        [cat]: e.target.value,
                      })
                    }
                    placeholder="0.00"
                    className="max-w-[160px]"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <FieldLabel label="Other Expenses" optional />
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.otherExpenseAmount}
            onChange={(e) => set("otherExpenseAmount", e.target.value)}
            placeholder="Amount"
          />
          <Input
            value={form.otherExpenseExplanation}
            onChange={(e) => set("otherExpenseExplanation", e.target.value)}
            placeholder="Explanation"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-input bg-muted/20 px-4 py-3">
        <span className="text-sm font-medium">Total Estimated Reimbursement</span>
        <span className="text-base font-semibold">
          {form.currency ? `${form.currency} ` : ""}
          {totalReimbursement.toFixed(2)}
        </span>
      </div>

      <div>
        <FieldLabel label="Cost Justification" required />
        <textarea
          value={form.costJustification}
          onChange={(e) => set("costJustification", e.target.value)}
          placeholder="Explain why the requested expenses are necessary..."
          rows={4}
          className={textareaClass(!!errors.costJustification)}
        />
        <FieldError message={errors.costJustification} />
      </div>
    </div>
  );

  const renderPage5 = () => (
    <div className="space-y-5">
      <div className="rounded-lg border border-input bg-muted/20 p-4 text-sm leading-relaxed text-foreground">
        By submitting this proposal, I agree to complete and submit a detailed
        post-event report within 30 days of the event&apos;s conclusion. The
        report will include attendance figures, outcomes, budget actuals, and
        any supporting documentation requested by the review team.
      </div>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={form.agreesToReport}
          onChange={(e) => set("agreesToReport", e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
        />
        <span className="text-sm font-medium">
          I agree to submit a post-event report
          <span className="ml-1 text-destructive">*</span>
        </span>
      </label>
      <FieldError message={errors.agreesToReport} />
    </div>
  );

  const renderPage6 = () => (
    <div className="space-y-4">
      <div>
        <FieldLabel label="Supporting Documents" optional />
        <p className="mb-2 text-xs text-muted-foreground">
          Examples: budget spreadsheet, venue quote, event flyer, presentation
          slides, prior event report.
        </p>
        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input py-8 transition-colors hover:bg-muted/20"
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-sm text-muted-foreground">Click to upload files</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              set("supportingFiles", [...form.supportingFiles, ...files]);
              e.target.value = "";
            }}
          />
        </div>
        {form.supportingFiles.length > 0 && (
          <ul className="mt-2 space-y-1">
            {form.supportingFiles.map((file, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5 text-sm"
              >
                <span className="mr-2 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    set(
                      "supportingFiles",
                      form.supportingFiles.filter((_, j) => j !== i),
                    )
                  }
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <FieldLabel label="Additional Notes" optional />
        <textarea
          value={form.additionalNotes}
          onChange={(e) => set("additionalNotes", e.target.value)}
          placeholder="Any other information you'd like to include..."
          rows={4}
          className={textareaClass(false)}
        />
      </div>
    </div>
  );

  const renderPage = () => {
    switch (page) {
      case 1: return renderPage1();
      case 2: return renderPage2();
      case 3: return renderPage3();
      case 4: return renderPage4();
      case 5: return renderPage5();
      case 6: return renderPage6();
      default: return null;
    }
  };

  // ── Stepper ──────────────────────────────────────────────────────────────

  const renderStepper = () => (
    <div className="mb-6 flex items-center">
      {Array.from({ length: TOTAL_PAGES }, (_, i) => {
        const p = i + 1;
        const isActive = p === page;
        const isDone = p < page;
        return (
          <div key={p} className="flex flex-1 items-center">
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isDone
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {isDone ? "✓" : p}
            </div>
            {p < TOTAL_PAGES && (
              <div
                className={`mx-1 h-0.5 flex-1 ${p < page ? "bg-primary/40" : "bg-muted"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={PAGE_TITLES[page - 1]}
      size="3xl"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {page > 1 && (
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
            )}
            {page < TOTAL_PAGES ? (
              <Button onClick={handleNext}>Next</Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit Proposal"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {renderStepper()}
      {renderPage()}
      {submitError && (
        <p className="mt-4 text-sm text-destructive">{submitError}</p>
      )}
    </Modal>
  );
}
