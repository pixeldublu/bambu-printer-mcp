export type SelectableFilamentTray = {
  slot: number | null;
  loaded: boolean;
  tray_type: string | null;
  resolved_profile_path: string | null;
};

export type FilamentSelection = {
  source: "explicit-slots" | "material-type" | "single-material-auto";
  loadFilaments: string;
  slots: number[];
  materialTypes: string[];
};

function normalizeMaterialType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function describeAvailable(trays: SelectableFilamentTray[]): string {
  const values = trays
    .filter((tray) => tray.loaded && tray.slot !== null)
    .map((tray) => `${tray.slot}:${normalizeMaterialType(tray.tray_type) || "UNKNOWN"}`);
  return values.length > 0 ? values.join(", ") : "none";
}

export function selectFilamentsForSlice(
  trays: SelectableFilamentTray[],
  currentSlot: number | null,
  options: { filamentType?: unknown; amsSlots?: unknown; autoSelect?: boolean } = {}
): FilamentSelection | null {
  const requestedType = normalizeMaterialType(options.filamentType);
  const hasExplicitSlots = options.amsSlots !== undefined;

  if (hasExplicitSlots) {
    if (!Array.isArray(options.amsSlots) || options.amsSlots.length === 0) {
      throw new Error("ams_slots must be a non-empty array of zero-based physical AMS slots.");
    }

    const slots = options.amsSlots.map((value) => Number(value));
    if (slots.some((slot) => !Number.isInteger(slot) || slot < 0 || slot >= 254)) {
      throw new Error("ams_slots must contain only integer physical AMS slots from 0 through 253.");
    }
    if (new Set(slots).size !== slots.length) {
      throw new Error("ams_slots must not contain duplicate physical slots.");
    }

    const selected = slots.map((slot) => {
      const tray = trays.find((candidate) => candidate.slot === slot);
      if (!tray?.loaded) {
        throw new Error(`AMS slot ${slot} is empty or unavailable. Loaded slots: ${describeAvailable(trays)}.`);
      }
      if (!tray.resolved_profile_path) {
        throw new Error(`AMS slot ${slot} has no resolvable BambuStudio filament profile.`);
      }
      const actualType = normalizeMaterialType(tray.tray_type);
      if (requestedType && actualType !== requestedType) {
        throw new Error(
          `Material mismatch: requested ${requestedType}, but AMS slot ${slot} contains ${actualType || "UNKNOWN"}.`
        );
      }
      return { ...tray, actualType: actualType || "UNKNOWN" };
    });

    return {
      source: "explicit-slots",
      loadFilaments: selected.map((tray) => tray.resolved_profile_path).join(";"),
      slots,
      materialTypes: selected.map((tray) => tray.actualType),
    };
  }

  const eligible = trays.filter(
    (tray): tray is SelectableFilamentTray & { slot: number; resolved_profile_path: string } =>
      tray.loaded && tray.slot !== null && Boolean(tray.resolved_profile_path)
  );

  if (requestedType) {
    const matching = eligible.filter(
      (tray) => normalizeMaterialType(tray.tray_type) === requestedType
    );
    if (matching.length === 0) {
      throw new Error(
        `No loaded AMS filament matches requested material ${requestedType}. Loaded slots: ${describeAvailable(trays)}.`
      );
    }
    const selected = matching.find((tray) => tray.slot === currentSlot) || matching[0];
    return {
      source: "material-type",
      loadFilaments: selected.resolved_profile_path,
      slots: [selected.slot],
      materialTypes: [requestedType],
    };
  }

  if (!options.autoSelect) return null;
  if (eligible.length === 0) return null;

  const materialTypes = new Set(
    eligible.map((tray) => normalizeMaterialType(tray.tray_type) || "UNKNOWN")
  );
  if (materialTypes.size !== 1) {
    throw new Error(
      `Ambiguous loaded AMS materials (${Array.from(materialTypes).join(", ")}). Pass filament_type or ams_slots; loaded slots: ${describeAvailable(trays)}.`
    );
  }

  const selected = eligible.find((tray) => tray.slot === currentSlot) || eligible[0];
  return {
    source: "single-material-auto",
    loadFilaments: selected.resolved_profile_path,
    slots: [selected.slot],
    materialTypes: [normalizeMaterialType(selected.tray_type) || "UNKNOWN"],
  };
}
