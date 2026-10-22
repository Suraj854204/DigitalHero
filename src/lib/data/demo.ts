/**
 * DEMO DATA. Used ONLY when Supabase is not configured (local preview) and mirrored by
 * supabase/seed.sql with is_demo = true. These organisations are fictional: no partnership,
 * accreditation, impact figure or testimonial is implied. The UI labels all of it as demo.
 */
export interface CharityRow {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  category: string | null;
  location: string | null;
  image_url: string | null;
  image_alt: string | null;
  website_url: string | null;
  is_featured: boolean;
  is_demo: boolean;
  status: "active" | "inactive" | "archived";
}

const mk = (i: number, slug: string, name: string, category: string, location: string, short: string, featured = false): CharityRow => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  slug,
  name,
  short_description: short,
  description:
    `${short}\n\nThis is a fictional demonstration organisation used to show how a charity profile reads inside Digital Heroes. ` +
    `Real charity profiles are written and approved by administrators, and contain only verified information. ` +
    `Nothing on this page describes a real partnership, accreditation or measured outcome.`,
  category,
  location,
  image_url: null,
  image_alt: null,
  website_url: null,
  is_featured: featured,
  is_demo: true,
  status: "active",
});

export const DEMO_CHARITIES: CharityRow[] = [
  mk(1, "demo-bright-start-learning", "Demo: Bright Start Learning", "Education", "Pune, India", "A fictional charity funding school supplies and tutoring for first-generation learners.", true),
  mk(2, "demo-clear-water-collective", "Demo: Clear Water Collective", "Health", "Jaipur, India", "A fictional charity imagining safe drinking water for rural clinics."),
  mk(3, "demo-restore-the-river", "Demo: Restore the River", "Environment", "Guwahati, India", "A fictional charity restoring riverbank habitats with local volunteers."),
  mk(4, "demo-open-door-meals", "Demo: Open Door Meals", "Community", "Chennai, India", "A fictional community kitchen that serves a hot meal to anyone who walks in."),
  mk(5, "demo-second-chance-strays", "Demo: Second Chance Strays", "Animal welfare", "Bengaluru, India", "A fictional shelter that vaccinates, rehomes and rehabilitates street animals."),
  mk(6, "demo-play-forward-youth", "Demo: Play Forward Youth", "Youth", "Kolkata, India", "A fictional programme that opens up sport and mentoring to teenagers."),
];

export const DEMO_PLANS = [
  { id: "monthly", name: "Monthly", interval: "month", amount_minor: 99900 },
  { id: "yearly", name: "Yearly", interval: "year", amount_minor: 999000 },
] as const;

export const DEFAULT_PUBLIC_SETTINGS = {
  prizePoolBps: 5000,
  minCharityBps: 1000,
  prizePoolConfirmed: false,
  tierConfig: { shareBps: { 5: 4000, 4: 3500, 3: 2500 }, rollover: { 5: true, 4: false, 3: false }, unclaimedPolicy: "reserve" as const },
};
