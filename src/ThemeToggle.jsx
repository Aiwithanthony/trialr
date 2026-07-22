import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";

const THEMES = [
  ["light", "Light", IconSun],
  ["system", "System", IconDeviceDesktop],
  ["dark", "Dark", IconMoon],
];

export function ThemeToggle({ value, onChange }) {
  return (
    <div className="v2-theme-toggle" role="group" aria-label="Appearance">
      {THEMES.map(([theme, label, Icon]) => (
        <button
          type="button"
          key={theme}
          className={value === theme ? "v2-theme-option v2-theme-option-active" : "v2-theme-option"}
          onClick={() => onChange(theme)}
          aria-label={`Use ${label.toLowerCase()} appearance`}
          aria-pressed={value === theme}
          title={label}
        >
          <Icon size={15} stroke={1.7} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
