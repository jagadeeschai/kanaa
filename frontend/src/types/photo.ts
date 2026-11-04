// ---- Library (DB-backed) ----

export type Library = {
  id: number;
  name: string;
  root_path: string;
  photo_count: number;
  video_count: number;
  last_scanned: string | null;
  created_at: string | null;
  is_online: boolean;
};

export type LibraryCreate = {
  name: string;
  root_path: string;
};

export type LibraryUpdate = {
  name?: string;
};

export type AiModelSettings = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AppSettings = {
  edit_workspace_dir: string;
};

export type AppSettingsUpdate = {
  edit_workspace_dir?: string;
};

export type ScanStatus = {
  running: boolean;
  processed: number;
  total: number;
  percent: number;
  phase: string;
  error: string | null;
};

// ---- Photo (DB-backed) ----

export type Photo = {
  folder?: string | null;
  has_original_backup?: boolean;
  id: number;
  library_id: number;
  absolute_path?: string | null;
  relative_path: string;
  filename: string;
  file_extension: string;
  file_size: number;
  file_mtime_ns: number | null;
  date_taken: string | null;
  width: number | null;
  height: number | null;
  gps_lat: number | null;
  gps_lon: number | null;
  camera_make: string | null;
  camera_model: string | null;
  lens_model: string | null;
  focal_length: number | null;
  f_number: number | null;
  iso: number | null;
  exposure_time: string | null;
  is_favorite: boolean;
  is_flagged: boolean;
  rating: number;
  cull_status: 'none' | 'pick' | 'reject';
  is_raw: boolean;
  photo_type: string;
  media_type: string;
  duration: number | null;
  codec: string | null;
  person_count: number;
  face_count: number;
  edit_settings: PhotoEditSettings | null;
  blur_score: number | null;
  blur_dismissed: boolean;
  duplicate_group_key: string | null;
};

export type PhotoListResponse = {
  photos: Photo[];
  total: number;
  counts: Record<string, number>;
};

export type PhotoEditSettings = {
  rotate_quadrants?: number;
  straighten?: number;
  crop_left?: number;
  crop_right?: number;
  crop_top?: number;
  crop_bottom?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  warmth?: number;
  sharpness?: number;
  vignette?: number;
  // Advanced editing
  flip_h?: boolean;
  flip_v?: boolean;
  filter?: string;
  highlights?: number;
  shadows?: number;
  clarity?: number;
  blur?: number;
  grain?: number;
};

export type PhotoUpdate = {
  is_favorite?: boolean;
  is_flagged?: boolean;
  rating?: number;
  cull_status?: 'none' | 'pick' | 'reject';
  date_taken?: string;
  photo_type?: string;
  edit_settings?: PhotoEditSettings;
};

export type PhotoEditOutputMode = 'catalog' | 'copy' | 'replace';

export type PhotoEditOutputRequest = {
  mode: PhotoEditOutputMode;
  edit_settings?: PhotoEditSettings;
  ai_image_url?: string;
};

export type DeletePhotoMode = 'catalog' | 'trash';

export type WorkspaceCopyResponse = Photo;

// ---- Timeline ----

export type TimelineDay = {
  day: string;
  count: number;
};

export type TimelineMonth = {
  month: string;
  days: TimelineDay[];
  count: number;
};

export type TimelineYear = {
  year: string;
  months: TimelineMonth[];
  count: number;
  video_count: number;
};

export type TimelineResponse = {
  years: TimelineYear[];
  total: number;
};

// ---- Stats ----

export type StatsResponse = {
  total_photos: number;
  total_size: number;
  real_photos: number;
  screenshots: number;
  favorites: number;
  with_gps: number;
  with_faces: number;
  with_people: number;
  cameras: { model: string; count: number }[];
};

export type FaceCluster = {
  id: number;
  library_id: number;
  cluster_key: string;
  label: string;
  cover_photo_id: number | null;
  face_count: number;
  photo_count: number;
};

// ---- Detection ----

export type Box = {
  id?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  label?: string;
};

export type DetectResponse = {
  relative_path: string;
  width: number;
  height: number;
  persons: Box[];
  faces: Box[];
  objects?: Box[];
};

export type DetectionMode = 'basic' | 'advanced';

export type DetectBatchByIdRequest = {
  photo_ids: number[];
  mode?: DetectionMode;
};

export type DetectBatchByIdResponse = {
  results: Record<string, DetectResponse>;
  processed: number;
};

// ---- Blur detection --------------------------------------------------------

export type BlurAnalyzeResponse = {
  blur_score: number;
  is_blurry: boolean;
  threshold: number;
};

export type BlurResult = {
  photo_id: number;
  blur_score: number;
  is_blurry: boolean;
};

export type LibraryBlurAnalyzeResponse = {
  analyzed: number;
  blurry_count: number;
  results: BlurResult[];
};

export type BlurJobStartResponse = {
  job_id: string;
};

export type RenderJob = {
  job_id: string;
  kind: string;
  label: string;
  status: 'queued' | 'running' | 'cancelling' | 'done' | 'failed' | 'cancelled';
  progress: number;
  done: boolean;
  phase: string | null;
  error: string | null;
  output_photo_id: number | null;
};

export type JobStatusResponse = {
  status?: string | null;
  label?: string | null;
  phase?: string | null;
  warning?: string | null;
  lyric_cues?: import('../utils/lyrics').LyricCue[] | null;
  output_photo_id?: number | null;
  job_id: string;
  kind: string;
  progress: number;
  total: number;
  done: boolean;
  blurry_count: number;
  library_id: number | null;
  error: string | null;
};

export type BlurScanMode = 'blocking' | 'background';

export type ScanMode = 'realtime' | 'batch';

export type BlurScanJobState = {
  jobId: string;
  libraryId: number;
  libraryName: string;
  mode: BlurScanMode;
  progress: number;
  total: number;
  done: boolean;
  blurryCount: number;
  error: string | null;
};

// ---- Generic background jobs (faces, duplicates) --------------------------

export type JobStartResponse = {
  job_id: string;
};

export type FaceJobState = {
  jobId: string;
  libraryId: number;
  libraryName: string;
  progress: number;
  total: number;
  done: boolean;
  error: string | null;
};

export type DuplicateJobState = {
  jobId: string;
  libraryId: number;
  libraryName: string;
  progress: number;
  total: number;
  done: boolean;
  error: string | null;
};

// ---- Duplicate detection --------------------------------------------------

export type DuplicateAnalyzeResponse = {
  analyzed: number;
  group_count: number;
  duplicate_count: number;
};

export type DuplicateGroup = {
  group_key: string;
  photo_ids: number[];
  cover_photo_id: number;
  count: number;
};

// ---- Browse (folder picker) ----

export type BrowseEntry = {
  name: string;
  path: string;
};

export type BrowseResponse = {
  current: string;
  parent: string | null;
  entries: BrowseEntry[];
};

export type QuickPath = {
  label: string;
  path: string;
};

// ---- Organize (legacy) ----

export type OrganizeResponse = {
  success: boolean;
  root_path: string;
  moved: number;
  skipped: number;
  destination_root?: string;
};

export type VideoEditSettings = {
  background_photo_ids?: number[];
  image_animation?: 'none' | 'zoom-in' | 'pan-left' | 'ken-burns';
  slide_starts?: number[];
  transition?: 'none' | 'crossfade';
  quality?: '720p' | '1080p' | '4k';
  lyric_style?: 'outline' | 'shadow' | 'band';
  lyric_animation?: 'none' | 'fade' | 'slide-up' | 'pop';
  lyric_font?: 'standard' | 'elegant' | 'modern' | 'playful' | 'handwritten';
  lyric_align?: 'left' | 'center' | 'right';
  lyric_band_color?: string;
  audio_asset_id?: string;
  lyrics?: { start: number; end: number; text: string }[];
  canvas?: 'original' | 'portrait' | 'square' | 'landscape';
  lyric_color?: string;
  lyric_size?: number;
  lyric_position?: 'top' | 'center' | 'bottom';
  trim_start: number;
  trim_end: number | null;
  rotation: 0 | 90 | 180 | 270;
  flip_horizontal: boolean;
  flip_vertical: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  volume: number;
  mute: boolean;
  keep_location?: boolean;
};
