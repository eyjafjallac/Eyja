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
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="memo-svg"
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
