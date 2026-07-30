/** דגמי מכשירים לתצוגה מקדימה רספונסיבית — viewport בפיקסלים לוגיים (CSS) */
export interface DevicePreset {
  id: string
  label: string
  width: number
  height: number
  kind: 'phone' | 'tablet'
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, kind: 'phone' },
  { id: 'iphone-15', label: 'iPhone 15 / 15 Pro', width: 393, height: 852, kind: 'phone' },
  { id: 'iphone-15-max', label: 'iPhone 15 Pro Max', width: 430, height: 932, kind: 'phone' },
  { id: 'galaxy-s24', label: 'Samsung Galaxy S24', width: 360, height: 780, kind: 'phone' },
  { id: 'pixel-8', label: 'Google Pixel 8', width: 412, height: 915, kind: 'phone' },
  { id: 'ipad', label: 'iPad', width: 820, height: 1180, kind: 'tablet' },
  { id: 'ipad-pro', label: 'iPad Pro 12.9″', width: 1024, height: 1366, kind: 'tablet' }
]

export function getDevicePreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((d) => d.id === id)
}
