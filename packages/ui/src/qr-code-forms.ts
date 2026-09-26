import type { QrData } from "@labelmaker/domain";

export type QrFormValues = Readonly<Record<string, string | boolean>>;
type QrField = {
  readonly key: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly type?:
    | "textarea"
    | "url"
    | "email"
    | "tel"
    | "password"
    | "decimal"
    | "checkbox";
  readonly required?: boolean;
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
};
type QrFormDefinition = {
  readonly label: string;
  readonly fields: readonly QrField[];
  readonly defaults?: QrFormValues;
  readonly toData: (values: QrFormValues) => QrData;
};
export const qrFieldText = (values: QrFormValues, key: string) =>
  String(values[key] ?? "");

export const QR_FORMS: Record<QrData["type"], QrFormDefinition> = {
  text: {
    label: "Text",
    fields: [
      {
        key: "text",
        label: "Text",
        type: "textarea",
        placeholder: "Enter the text to scan",
        required: true,
      },
    ],
    toData: (v) => ({ type: "text", text: qrFieldText(v, "text") }),
  },
  url: {
    label: "Website",
    fields: [
      {
        key: "url",
        label: "Website address",
        type: "url",
        placeholder: "https://example.com",
        required: true,
      },
    ],
    toData: (v) => ({ type: "url", url: qrFieldText(v, "url") }),
  },
  wifi: {
    label: "Wi-Fi network",
    defaults: { security: "WPA", hidden: false },
    fields: [
      {
        key: "ssid",
        label: "Network name",
        placeholder: "Network name (SSID)",
        required: true,
      },
      {
        key: "security",
        label: "Security",
        options: [
          { value: "WPA", label: "WPA / WPA2 / WPA3" },
          { value: "WEP", label: "WEP" },
          { value: "nopass", label: "No password" },
        ],
      },
      {
        key: "password",
        label: "Password",
        type: "password",
        placeholder: "Network password",
      },
      { key: "hidden", label: "Hidden network", type: "checkbox" },
    ],
    toData: (v) => ({
      type: "wifi",
      ssid: qrFieldText(v, "ssid"),
      password: v.security === "nopass" ? "" : qrFieldText(v, "password"),
      security:
        v.security === "WEP"
          ? "WEP"
          : v.security === "nopass"
            ? "nopass"
            : "WPA",
      hidden: v.hidden === true,
    }),
  },
  email: {
    label: "Email",
    fields: [
      {
        key: "address",
        label: "Email address",
        type: "email",
        placeholder: "name@example.com",
        required: true,
      },
      { key: "subject", label: "Subject", placeholder: "Optional subject" },
      {
        key: "body",
        label: "Message",
        type: "textarea",
        placeholder: "Optional message",
      },
    ],
    toData: (v) => ({
      type: "email",
      address: qrFieldText(v, "address"),
      subject: qrFieldText(v, "subject"),
      body: qrFieldText(v, "body"),
    }),
  },
  phone: {
    label: "Phone number",
    fields: [
      {
        key: "number",
        label: "Phone number",
        type: "tel",
        placeholder: "+1 555 010 1234",
        required: true,
      },
    ],
    toData: (v) => ({ type: "phone", number: qrFieldText(v, "number") }),
  },
  sms: {
    label: "Text message (SMS)",
    fields: [
      {
        key: "number",
        label: "Phone number",
        type: "tel",
        placeholder: "+1 555 010 1234",
        required: true,
      },
      {
        key: "message",
        label: "Message",
        type: "textarea",
        placeholder: "Optional message",
      },
    ],
    toData: (v) => ({
      type: "sms",
      number: qrFieldText(v, "number"),
      message: qrFieldText(v, "message"),
    }),
  },
  contact: {
    label: "Contact (vCard)",
    fields: [
      { key: "firstName", label: "First name", placeholder: "First name" },
      { key: "lastName", label: "Last name", placeholder: "Last name" },
      {
        key: "organization",
        label: "Organization",
        placeholder: "Optional organization",
      },
      {
        key: "phone",
        label: "Phone number",
        type: "tel",
        placeholder: "Optional phone number",
      },
      {
        key: "email",
        label: "Email address",
        type: "email",
        placeholder: "Optional email address",
      },
      {
        key: "url",
        label: "Website address",
        type: "url",
        placeholder: "https://example.com",
      },
      {
        key: "address",
        label: "Address",
        type: "textarea",
        placeholder: "Optional postal address",
      },
    ],
    toData: (v) => ({
      type: "contact",
      firstName: qrFieldText(v, "firstName"),
      lastName: qrFieldText(v, "lastName"),
      organization: qrFieldText(v, "organization"),
      phone: qrFieldText(v, "phone"),
      email: qrFieldText(v, "email"),
      url: qrFieldText(v, "url"),
      address: qrFieldText(v, "address"),
    }),
  },
  geo: {
    label: "Location",
    fields: [
      {
        key: "latitude",
        label: "Latitude",
        type: "decimal",
        placeholder: "−90 to 90",
        required: true,
      },
      {
        key: "longitude",
        label: "Longitude",
        type: "decimal",
        placeholder: "−180 to 180",
        required: true,
      },
    ],
    toData: (v) => ({
      type: "geo",
      latitude: Number(qrFieldText(v, "latitude")),
      longitude: Number(qrFieldText(v, "longitude")),
    }),
  },
};

export function qrFormValues(data: QrData): QrFormValues {
  const values: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "type")
      values[key] = typeof value === "boolean" ? value : String(value);
  }
  return values;
}

export function qrDataFromForm(
  type: QrData["type"],
  values: QrFormValues,
): QrData {
  for (const field of QR_FORMS[type].fields) {
    if (field.required && !qrFieldText(values, field.key).trim())
      throw new Error(`Enter ${field.label.toLowerCase()}.`);
  }
  return QR_FORMS[type].toData(values);
}

export function missingQrFields(
  type: QrData["type"],
  values: QrFormValues,
): string[] {
  const missing: string[] = [];
  for (const field of QR_FORMS[type].fields) {
    if (field.required && !qrFieldText(values, field.key).trim())
      missing.push(field.key);
  }
  if (
    type === "contact" &&
    !["firstName", "lastName"].some((key) => qrFieldText(values, key).trim())
  ) {
    missing.push("firstName", "lastName");
  }
  return missing;
}
