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
export declare function selectFilamentsForSlice(trays: SelectableFilamentTray[], currentSlot: number | null, options?: {
    filamentType?: unknown;
    amsSlots?: unknown;
    autoSelect?: boolean;
}): FilamentSelection | null;
