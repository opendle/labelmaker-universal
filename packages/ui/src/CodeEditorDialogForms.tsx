import type { QrData } from "@labelmaker/domain";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { CodeTextarea, CodeToggle } from "./CodeFormControls.js";
import { missingQrFields } from "./qr-code-forms.js";

import {
  QR_FORMS,
  qrFieldText as text,
  type QrFormValues,
} from "./qr-code-forms.js";

export function QrFields({
  type,
  values,
  onChange,
}: {
  readonly type: QrData["type"];
  readonly values: QrFormValues;
  readonly onChange: (key: string, value: string | boolean) => void;
}) {
  const missing = missingQrFields(type, values);
  return (
    <>
      {QR_FORMS[type].fields.map((field) => {
        if (field.key === "password" && values.security === "nopass")
          return null;
        const id = `code-field-${field.key}`;
        if (field.type === "password")
          return (
            <PasswordField
              key={field.key}
              value={text(values, field.key)}
              onChange={(value) => onChange(field.key, value)}
            />
          );
        if (field.type === "checkbox")
          return (
            <CodeToggle
              key={field.key}
              label={field.label}
              checked={values[field.key] === true}
              onChange={(checked) => onChange(field.key, checked)}
            />
          );
        return (
          <label className="field code-field" htmlFor={id} key={field.key}>
            <span>{field.label}</span>
            {field.options ? (
              <select
                aria-label={field.label}
                id={id}
                onChange={(event) => onChange(field.key, event.target.value)}
                value={text(values, field.key)}
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <CodeTextarea
                aria-label={field.label}
                aria-describedby="code-editor-status"
                aria-invalid={missing.includes(field.key)}
                id={id}
                maxLength={4096}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={field.placeholder}
                required={field.required}
                rows={3}
                value={text(values, field.key)}
              />
            ) : (
              <input
                aria-label={field.label}
                aria-describedby="code-editor-status"
                aria-invalid={missing.includes(field.key)}
                autoCapitalize="off"
                autoComplete="off"
                id={id}
                inputMode={field.type === "decimal" ? "decimal" : undefined}
                maxLength={2048}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={field.placeholder}
                required={field.required}
                spellCheck={false}
                type={
                  field.type === "decimal" ? "text" : (field.type ?? "text")
                }
                value={text(values, field.key)}
              />
            )}
          </label>
        );
      })}
    </>
  );
}

function PasswordField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field code-field">
      <span id="code-password-label">Password</span>
      <div className="code-password-field">
        <input
          aria-labelledby="code-password-label"
          aria-describedby="code-editor-status"
          autoCapitalize="off"
          autoComplete="off"
          id="code-field-password"
          maxLength={2048}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Network password"
          spellCheck={false}
          type={visible ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="icon-button"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
