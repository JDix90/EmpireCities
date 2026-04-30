import mongoose, { Schema, Document } from 'mongoose';

/**
 * Per-user rating row. Enforces "one rating per user per map" via a unique
 * compound index, so spam-rating a map by repeatedly hitting POST /rate
 * either no-ops (same rating again) or updates the user's existing row to
 * the new value. Aggregation over this collection is the source of truth
 * for the cached `rating` and `rating_count` fields on the parent
 * `CustomMap` document — never read those directly for new ratings.
 */
export interface IMapRating extends Document {
  map_id: string;
  user_id: string;
  rating: number;
  created_at: Date;
  updated_at: Date;
}

const MapRatingSchema = new Schema<IMapRating>(
  {
    map_id: { type: String, required: true, index: true },
    user_id: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

MapRatingSchema.index({ map_id: 1, user_id: 1 }, { unique: true });

export const MapRating = mongoose.model<IMapRating>('MapRating', MapRatingSchema);
