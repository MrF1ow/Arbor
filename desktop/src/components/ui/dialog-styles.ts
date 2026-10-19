const DIALOG_BACKDROP_BASE =
  "fixed inset-0 z-overlay bg-backdrop transition-opacity duration-panel ease-out-soft data-ending-style:opacity-0 data-starting-style:opacity-0";

const DIALOG_POPUP_BASE =
  "fixed top-1/2 left-1/2 z-dialog grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-card outline-none transition-[opacity,transform] duration-panel ease-out-soft data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:scale-98 data-starting-style:scale-98"; // style-allow: scale-98 dialog enter animation

export const DIALOG_BACKDROP_CLASS = DIALOG_BACKDROP_BASE;
export const DIALOG_POPUP_CLASS = DIALOG_POPUP_BASE;

export const SHEET_BACKDROP_CLASS = DIALOG_BACKDROP_BASE;

export const SHEET_POPUP_SIDE_CLASS =
  "fixed z-drawer flex flex-col border-border bg-popover text-popover-foreground shadow-card transition duration-panel ease-out-soft data-ending-style:opacity-0 data-starting-style:opacity-0";
