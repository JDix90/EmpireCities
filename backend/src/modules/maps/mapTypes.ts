export interface Territory {
  territory_id: string;
  name: string;
  polygon: number[][];
  center_point: [number, number];
  region_id: string;
  geo_polygon?: [number, number][];
  globe_id?: 'earth' | 'moon';
  world_id?: string;
  galaxy_position?: [number, number];
}

export interface Connection {
  from: string;
  to: string;
  type: 'land' | 'sea' | 'orbit';
}

export interface Region {
  region_id: string;
  name: string;
  bonus: number;
}

export interface GameMap {
  map_id: string;
  name: string;
  description: string;
  era_theme:
    | 'ancient'
    | 'medieval'
    | 'discovery'
    | 'ww2'
    | 'coldwar'
    | 'modern'
    | 'acw'
    | 'risorgimento'
    | 'space_age'
    | 'galaxy_age'
    | 'custom';
  canvas_width: number;
  canvas_height: number;
  projection_bounds?: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  globe_view?: {
    lock_rotation?: boolean;
    center_lat?: number;
    center_lng?: number;
    altitude?: number;
  };
  map_kind?: 'standard' | 'galaxy';
  worlds?: Array<{
    world_id: string;
    display_name: string;
    globe_image_url?: string;
    bump_image_url?: string;
    show_atmosphere?: boolean;
    atmosphere_color?: string;
    atmosphere_altitude?: number;
    background_color?: string;
    requires_orbit_access?: boolean;
  }>;
  orbit_access?: 'none' | 'space_age_moon' | 'galaxy_hyperspace';
  territories: Territory[];
  connections: Connection[];
  regions: Region[];
  is_public: boolean;
  moderation_status: string;
  creator_id: string;
  play_count: number;
  rating_sum: number;
  rating_count: number;
  created_at: Date;
}

export interface MapSummary {
  map_id: string;
  name: string;
  description: string;
  era_theme: string;
  territory_count: number;
  region_count: number;
  is_public: boolean;
  play_count: number;
  avg_rating: number;
  creator_id: string;
}
