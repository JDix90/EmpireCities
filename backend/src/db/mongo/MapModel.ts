import mongoose, { Schema, Document } from 'mongoose';

export interface IGeoConfigItem {
  iso: string;
  clip_bbox?: [number, number, number, number];
}

export interface ITerritory {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  region_id: string;
  /** ISO_A2 country codes for geographic boundaries */
  iso_codes?: string[];
  /** Clip merged geometry to [minLng, minLat, maxLng, maxLat] */
  clip_bbox?: [number, number, number, number];
  /** Per-country config for split regions; overrides iso_codes when present */
  geo_config?: IGeoConfigItem[];
  /** Polygon exterior ring in geographic [lng, lat] coords (globe editor) */
  geo_polygon?: [number, number][];
}

export interface IConnection {
  from: string;
  to: string;
  type: 'land' | 'sea';
}

export interface IRegion {
  region_id: string;
  name: string;
  bonus: number;
}

export interface ICustomMap extends Document {
  map_id: string;
  creator_id: string;
  name: string;
  description: string;
  era_theme?: string;
  background_image_url?: string;
  canvas_width?: number;
  canvas_height?: number;
  territories: ITerritory[];
  connections: IConnection[];
  regions: IRegion[];
  is_public: boolean;
  is_moderated: boolean;
  moderation_status: 'pending' | 'approved' | 'rejected';
  rating: number;
  rating_count: number;
  play_count: number;
  created_at: Date;
  updated_at: Date;
}

const TerritorySchema = new Schema<ITerritory>({
  territory_id: { type: String, required: true },
  name: { type: String, required: true },
  polygon: { type: [[Number]], required: true },
  center_point: { type: [Number], required: true },
  region_id: { type: String, required: true },
  iso_codes: { type: [String], default: undefined },
  clip_bbox: { type: [Number], default: undefined },
  geo_config: {
    type: [new Schema({ iso: String, clip_bbox: [Number] }, { _id: false })],
    default: undefined,
  },
  geo_polygon: { type: [[Number]], default: undefined },
});

const ConnectionSchema = new Schema<IConnection>({
  from: { type: String, required: true },
  to: { type: String, required: true },
  type: { type: String, enum: ['land', 'sea'], default: 'land' },
});

const RegionSchema = new Schema<IRegion>({
  region_id: { type: String, required: true },
  name: { type: String, required: true },
  bonus: { type: Number, required: true, default: 2 },
});

const CustomMapSchema = new Schema<ICustomMap>(
  {
    map_id: { type: String, required: true, unique: true },
    creator_id: { type: String, required: true },
    name: { type: String, required: true, maxlength: 64 },
    description: { type: String, default: '', maxlength: 512 },
    era_theme: { type: String },
    background_image_url: { type: String },
    canvas_width: { type: Number, default: 1200 },
    canvas_height: { type: Number, default: 700 },
    territories: { type: [TerritorySchema], required: true },
    connections: { type: [ConnectionSchema], required: true },
    regions: { type: [RegionSchema], required: true },
    is_public: { type: Boolean, default: false },
    is_moderated: { type: Boolean, default: false },
    moderation_status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    rating: { type: Number, default: 0 },
    rating_count: { type: Number, default: 0 },
    play_count: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

CustomMapSchema.index({ creator_id: 1 });
CustomMapSchema.index({ is_public: 1, moderation_status: 1 });
CustomMapSchema.index({ rating: -1 });
CustomMapSchema.index({ play_count: -1 });

export const CustomMap = mongoose.model<ICustomMap>('CustomMap', CustomMapSchema);
