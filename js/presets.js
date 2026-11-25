// The exercise library a blank install starts with (Store.seedLibrary, called
// once at startup): common lifts, each with its muscle group and the smallest
// weight step its equipment usually allows, in lb. A draft: the list and the
// steps are the owner's to change, and every entry can be edited or removed
// in Settings like one typed in by hand.
//
// The step is a fact about a gym's equipment, so these are the usual values,
// by equipment: 5 for a barbell, an EZ-bar and a Smith machine (a 2.5 lb
// plate on each side), 5 for dumbbells (a dumbbell lift is logged as the
// weight of one dumbbell), 5 for a cable, 10 for a machine with a weight
// stack or loaded with 5 lb plates on both sides (the reverse pec deck is 5,
// the owner's value), 5 for one loaded at one end only, and none for a
// bodyweight lift (the 2.5 default applies once weight is added). A name
// says which equipment its step is for. Names are
// unique ignoring case (history follows the name), and each group's lifts
// are listed compound first: the pickers keep this order inside a muscle
// group. There is no group for traps, forearms or adductors: shrugs are
// under Back, the other two under Other.
const BAR = 5, DUMBBELL = 5, CABLE = 5, MACHINE = 10, ONE_END = 5, BODY = null;

export const PRESET_EXERCISES = [
  ["Barbell Bench Press", "Chest", BAR],
  ["Incline Barbell Bench Press", "Chest", BAR],
  ["Dumbbell Bench Press", "Chest", DUMBBELL],
  ["Incline Dumbbell Bench Press", "Chest", DUMBBELL],
  ["Machine Chest Press", "Chest", MACHINE],
  ["Dip", "Chest", BODY],
  ["Push-Up", "Chest", BODY],
  ["Dumbbell Fly", "Chest", DUMBBELL],
  ["Cable Fly", "Chest", CABLE],
  ["Pec Deck", "Chest", MACHINE],

  ["Pull-Up", "Back", BODY],
  ["Chin-Up", "Back", BODY],
  ["Lat Pulldown", "Back", MACHINE],
  ["Barbell Row", "Back", BAR],
  ["Dumbbell Row", "Back", DUMBBELL],
  ["T-Bar Row", "Back", ONE_END],
  ["Seated Cable Row", "Back", MACHINE],
  ["Machine Row", "Back", MACHINE],
  ["Deadlift", "Back", BAR],
  ["Straight-Arm Pulldown", "Back", CABLE],
  ["Barbell Shrug", "Back", BAR],
  ["Dumbbell Shrug", "Back", DUMBBELL],

  ["Barbell Overhead Press", "Shoulders", BAR],
  ["Dumbbell Shoulder Press", "Shoulders", DUMBBELL],
  ["Machine Shoulder Press", "Shoulders", MACHINE],
  ["Dumbbell Lateral Raise", "Shoulders", DUMBBELL],
  ["Cable Lateral Raise", "Shoulders", CABLE],
  ["Dumbbell Rear Delt Fly", "Shoulders", DUMBBELL],
  ["Reverse Pec Deck", "Shoulders", 5], // the owner's value: this stack moves in 5s
  ["Face Pull", "Shoulders", CABLE],

  ["Barbell Curl", "Biceps", BAR],
  ["EZ-Bar Curl", "Biceps", BAR],
  ["Dumbbell Curl", "Biceps", DUMBBELL],
  ["Incline Dumbbell Curl", "Biceps", DUMBBELL],
  ["Hammer Curl", "Biceps", DUMBBELL],
  ["EZ-Bar Preacher Curl", "Biceps", BAR],
  ["Cable Curl", "Biceps", CABLE],

  ["Close-Grip Bench Press", "Triceps", BAR],
  ["Skull Crusher", "Triceps", BAR],
  ["Triceps Pushdown", "Triceps", CABLE],
  ["Overhead Cable Triceps Extension", "Triceps", CABLE],
  ["Dumbbell Overhead Triceps Extension", "Triceps", DUMBBELL],

  ["Back Squat", "Quads", BAR],
  ["Front Squat", "Quads", BAR],
  ["Hack Squat", "Quads", MACHINE],
  ["Leg Press", "Quads", MACHINE],
  ["Smith Machine Squat", "Quads", BAR],
  ["Bulgarian Split Squat", "Quads", DUMBBELL],
  ["Walking Lunge", "Quads", DUMBBELL],
  ["Goblet Squat", "Quads", DUMBBELL],
  ["Leg Extension", "Quads", MACHINE],

  ["Romanian Deadlift", "Hamstrings", BAR],
  ["Dumbbell Romanian Deadlift", "Hamstrings", DUMBBELL],
  ["Lying Leg Curl", "Hamstrings", MACHINE],
  ["Seated Leg Curl", "Hamstrings", MACHINE],
  ["Back Extension", "Hamstrings", BODY],

  ["Barbell Hip Thrust", "Glutes", BAR],
  ["Cable Glute Kickback", "Glutes", CABLE],
  ["Machine Hip Abduction", "Glutes", MACHINE],

  ["Standing Calf Raise", "Calves", MACHINE],
  ["Seated Calf Raise", "Calves", ONE_END],
  ["Leg Press Calf Raise", "Calves", MACHINE],

  ["Cable Crunch", "Abs", CABLE],
  ["Machine Crunch", "Abs", MACHINE],
  ["Hanging Leg Raise", "Abs", BODY],
  ["Crunch", "Abs", BODY],
  ["Ab Wheel Rollout", "Abs", BODY],

  ["Machine Hip Adduction", "Other", MACHINE],
  ["Barbell Wrist Curl", "Other", BAR],
].map(([name, muscleGroup, minIncrement]) => (minIncrement == null ? { name, muscleGroup } : { name, muscleGroup, minIncrement }));
