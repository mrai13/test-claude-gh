// The "Two Lifts, One Wall" plan as data. Values come straight from the PDF.
// For dumbbell exercises the logged weight is the weight of ONE dumbbell.

export const SESSIONS = {
  A: { id: 'A', name: 'Session A', subtitle: 'Squat & bench', day: 'Monday' },
  B: { id: 'B', name: 'Session B', subtitle: 'Press & legs', day: 'Saturday' },
};

export const EXERCISES = [
  {
    id: 'squat', session: 'A', name: 'Barbell Back Squat', key: true,
    sets: 3, repMin: 5, repMax: 8, restSec: 180, increment: 5,
    cue: 'Quads, glutes, whole trunk. Go to a depth you can hold with a flat back — usually just below parallel.',
  },
  {
    id: 'bench', session: 'A', name: 'Barbell Bench Press', key: true,
    sets: 3, repMin: 6, repMax: 10, restSec: 180, increment: 2.5,
    cue: 'Chest, front delts, triceps. Elbows at roughly 45°, bar touching the lower half of your chest.',
  },
  {
    id: 'rdl', session: 'A', name: 'Romanian Deadlift', key: false,
    sets: 3, repMin: 8, repMax: 10, restSec: 120, increment: 5,
    cue: 'Hamstrings, glutes, spinal erectors. Use straps.',
  },
  {
    id: 'row', session: 'A', name: 'Seated Cable Row', key: false,
    sets: 3, repMin: 10, repMax: 12, restSec: 90, increment: 2.5,
    cue: 'Mid-back and biceps. Kept moderate on purpose — Wednesday is your heavy pulling. Straps.',
  },
  {
    id: 'lateral', session: 'A', name: 'Dumbbell Lateral Raise', key: false,
    sets: 2, repMin: 12, repMax: 15, restSec: 60, increment: 2.5, dumbbell: true,
    cue: 'The one isolation move. Side delts are the width nothing else here builds.',
  },
  {
    id: 'bss', session: 'B', name: 'Bulgarian Split Squat', key: true,
    sets: 3, repMin: 8, repMax: 10, restSec: 120, increment: 2.5, dumbbell: true,
    cue: 'Per leg, dumbbells at your sides. Leg press is a fine substitute on a bad day.',
  },
  {
    id: 'ohp', session: 'B', name: 'Seated DB Overhead Press', key: true,
    sets: 3, repMin: 6, repMax: 10, restSec: 180, increment: 2.5, dumbbell: true,
    cue: 'Shoulders and triceps. Seated with back support so your lower back isn’t the limit.',
  },
  {
    id: 'incline', session: 'B', name: 'Incline Dumbbell Press', key: false,
    sets: 3, repMin: 8, repMax: 12, restSec: 120, increment: 2.5, dumbbell: true,
    cue: 'Upper chest, at 30° — a different angle from Monday’s flat bench.',
  },
  {
    id: 'pulldown', session: 'B', name: 'Lat Pulldown', key: false,
    sets: 3, repMin: 8, repMax: 12, restSec: 90, increment: 2.5,
    cue: 'Vertical pull for lat width. Straps — save your fingers for the wall.',
  },
  {
    id: 'legcurl', session: 'B', name: 'Lying or Seated Leg Curl', key: false,
    sets: 3, repMin: 10, repMax: 15, restSec: 60, increment: 2.5,
    cue: 'Hamstrings at the knee, which the split squat misses. Slow on the way back.',
  },
];

export const exerciseById = (id) => EXERCISES.find((e) => e.id === id);
export const exercisesFor = (session) => EXERCISES.filter((e) => e.session === session);

export const CYCLE_WEEKS = 9; // weeks 1–8 build, week 9 deload, week 10 = week 1 of next cycle
