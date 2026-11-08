const paths = {
  list: "M4 5.5h12M4 10h12M4 14.5h12",
  plus: "M10 4.5v11M4.5 10h11",
  color: "M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z",
  pin: "M7.5 3.5h5M8.5 3.5v4.5l-3 3.5h9l-3-3.5V3.5M10 11.5v5",
  collapse: "M5.5 12.5 10 8l4.5 4.5",
  expand: "M5.5 8 10 12.5 14.5 8",
  close: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  file: "M6 3.5h5l3.5 3.5v9.5H6zM11 3.5V7h3.5",
  folder: "M3.5 6h5l1.5 1.5h6.5v8h-13z",
  open: "M11.5 4h4.5v4.5M16 4l-6.5 6.5M14 11.5V16H4V6h4.5",
  trash: "M4.5 6h11M8 6V4h4v2M6 6l.8 10h6.4L14 6",
  export: "M4.5 10.5V16h11v-5.5M10 12.5V3.5M7 6.5 10 3.5l3 3",
  history: "M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM10 6.6V10l2.4 1.5",
  sidebar: "M5 4h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7.5 4v12",
  memo: "M6.5 4h7A2.5 2.5 0 0 1 16 6.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 13.5v-7A2.5 2.5 0 0 1 6.5 4zM11.5 4v4.5H16",
  reference: "M7 4.5H4.5v11H7M13 4.5h2.5v11H13M8.5 10h3",
  settings:
    "M12.6 10a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0zM10 3.2v1.6M10 15.2v1.6M3.2 10h1.6M15.2 10h1.6M5.2 5.2l1.1 1.1M13.7 13.7l1.1 1.1M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1",
  enlarge: "M3.5 15.5 8 4.5l4.5 11M5.2 12h5.6M15.5 13.5V5.5M13 8l2.5-2.5L18 8",
  back: "M15.5 10h-11M8.5 6l-4 4 4 4",
  text: "M4 5h12M10 5v11M6.5 16h7",
  window: "M5 4h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 8h14",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Symbol-only button whose label shows as a hover tooltip. */
export function SymButton({
  icon,
  label,
  pressed,
  danger = false,
  disabled = false,
  size,
  tipPos,
  tipAlign,
  onClick,
}: {
  icon: IconName;
  label: string;
  /** Set only for toggles; it drives `aria-pressed` and the active look. */
  pressed?: boolean;
  danger?: boolean;
  disabled?: boolean;
  size?: "sm" | "xs";
  tipPos?: "top";
  tipAlign?: "left" | "right";
  onClick: () => void;
}) {
  const classes = ["sym-btn"];
  if (size) classes.push(size);
  if (pressed) classes.push("active");
  if (danger) classes.push("danger");
  return (
    <button
      type="button"
      className={classes.join(" ")}
      data-tip={label}
      data-tip-pos={tipPos}
      data-tip-align={tipAlign}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
