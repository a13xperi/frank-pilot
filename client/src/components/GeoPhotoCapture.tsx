import { useRef, useState } from 'react';
import { Camera, MapPin, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/api/client';
import type { WorkOrderAttachmentKind } from '@/types';

/**
 * D2 — mobile/PWA-friendly capture of a geolocated, timestamped photo for a
 * maintenance work order, then upload to the attachments endpoint.
 *
 * The flow is two cheap device calls with no extra deps:
 *   1. navigator.geolocation.getCurrentPosition → { latitude, longitude }
 *   2. <input type="file" accept="image/*" capture="environment"> → opens the
 *      rear camera on mobile, falls back to a file picker on desktop. The image
 *      is read as a data: URL (kept small via canvas downscale) and POSTed as
 *      the attachment `url` — no object-storage wiring needed for the pilot.
 *
 * For a `completion_photo`, geolocation is REQUIRED before upload is allowed
 * (the backend gate rejects completion without a geolocated completion photo,
 * but we also block here so the tech gets immediate feedback). For arrival /
 * departure snapshots geo is best-effort.
 *
 * `onUploaded` fires after a successful POST so the parent can refresh state
 * (e.g. unlock the Complete button once a completion photo lands).
 */

type Coords = { latitude: number; longitude: number; accuracy: number | null };

const LABELS: Record<WorkOrderAttachmentKind, string> = {
  arrival: 'Arrival photo',
  departure: 'Departure photo',
  completion_photo: 'Completion photo',
  other: 'Photo',
};

export function GeoPhotoCapture({
  workOrderId,
  kind,
  onUploaded,
}: {
  workOrderId: string;
  kind: WorkOrderAttachmentKind;
  onUploaded?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const geoRequired = kind === 'completion_photo';

  function captureLocation() {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('This device does not support location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
        setLocating(false);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — enable it to attach a completion photo.'
            : 'Could not get your location. Try again.'
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await downscaleToDataUrl(file, 1024, 0.7);
      setPhoto(dataUrl);
    } catch {
      setError('Could not read that photo. Try again.');
    }
  }

  async function upload() {
    if (!photo) {
      setError('Take a photo first.');
      return;
    }
    if (geoRequired && !coords) {
      setError('Capture your location before uploading the completion photo.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await api.post(`/api/maintenance/${workOrderId}/attachments`, {
        url: photo,
        kind,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        takenAt: new Date().toISOString(),
      });
      setDone(true);
      onUploaded?.();
    } catch (err: any) {
      setError(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {LABELS[kind]} attached{coords ? ' with location' : ''}.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{LABELS[kind]}</span>
        {geoRequired && (
          <span className="text-xs text-gray-400">GPS required</span>
        )}
      </div>

      {/* Location row */}
      <button
        type="button"
        onClick={captureLocation}
        disabled={locating}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
        {coords ? 'Update location' : 'Capture location'}
      </button>
      {coords && (
        <p className="text-xs text-gray-500">
          {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)}
          {coords.accuracy != null ? ` (±${Math.round(coords.accuracy)}m)` : ''}
        </p>
      )}

      {/* Photo row — capture="environment" opens the rear camera on mobile */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <Camera className="h-4 w-4" />
        {photo ? 'Retake photo' : 'Take photo'}
      </button>
      {photo && (
        <img src={photo} alt={`${LABELS[kind]} preview`} className="h-32 w-full rounded-lg object-cover" />
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={upload}
        disabled={uploading || !photo || (geoRequired && !coords)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Attach {LABELS[kind].toLowerCase()}
      </button>
    </div>
  );
}

/**
 * Read an image File, downscale its longest edge to `maxEdge`, and return a
 * JPEG data: URL at the given quality. Keeps the payload comfortably under the
 * backend's 1mb JSON limit even from a high-res phone camera. Falls back to the
 * raw FileReader result if the canvas path is unavailable.
 */
async function downscaleToDataUrl(file: File, maxEdge: number, quality: number): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('decode failed'));
      i.src = rawDataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return rawDataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return rawDataUrl;
  }
}
