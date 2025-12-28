export interface Shortcut {
  trigger: string;
  label: string;
  description: string;
  expand: () => string;
}

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}/${month}/${day}`;
};

const formatTime = (date: Date): string => {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

const formatDateTime = (date: Date): string => {
  return `${formatDate(date)} ${formatTime(date)}`;
};

export const shortcuts: Shortcut[] = [
  {
    trigger: "@today",
    label: "Today",
    description: "Today's date",
    expand: () => formatDate(new Date()),
  },
  {
    trigger: "@now",
    label: "Now",
    description: "Current time",
    expand: () => formatDateTime(new Date()),
  },
  {
    trigger: "@datetime",
    label: "DateTime",
    description: "Current date and time",
    expand: () => formatDateTime(new Date()),
  },
  {
    trigger: "@tomorrow",
    label: "Tomorrow",
    description: "Tomorrow's date",
    expand: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return formatDate(d);
    },
  },
  {
    trigger: "@yesterday",
    label: "Yesterday",
    description: "Yesterday's date",
    expand: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return formatDate(d);
    },
  },
  {
    trigger: "@iso",
    label: "ISO Date",
    description: "Date in ISO format (YYYY-MM-DD)",
    expand: () => new Date().toISOString().split("T")[0],
  },
  {
    trigger: "@time",
    label: "Time",
    description: "Current time (24h format)",
    expand: () => formatTime(new Date()),
  },
];
