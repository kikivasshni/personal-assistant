import { Image, View } from 'react-native';

// Microsoft Fluent Emoji 3D (MIT licence, see assets/icons3d/LICENSE.txt).
// Bundled with the app so they work offline. Add one by dropping a PNG into
// assets/icons3d and listing it here.
const ICONS = {
  planner: require('../../assets/icons3d/planner.png'),
  manifest: require('../../assets/icons3d/manifest.png'),
  health: require('../../assets/icons3d/health.png'),
  study: require('../../assets/icons3d/study.png'),
  motivation: require('../../assets/icons3d/motivation.png'),
  career: require('../../assets/icons3d/career.png'),
  hobbies: require('../../assets/icons3d/hobbies.png'),
  finance: require('../../assets/icons3d/finance.png'),
  wellbeing: require('../../assets/icons3d/wellbeing.png'),
  food: require('../../assets/icons3d/food.png'),
  workout: require('../../assets/icons3d/workout.png'),
  pcos: require('../../assets/icons3d/pcos.png'),
  cloud: require('../../assets/icons3d/cloud.png'),
  terraform: require('../../assets/icons3d/terraform.png'),
  books: require('../../assets/icons3d/books.png'),
  guitar: require('../../assets/icons3d/guitar.png'),
  kathak: require('../../assets/icons3d/kathak.png'),
  camera: require('../../assets/icons3d/camera.png'),
  f1: require('../../assets/icons3d/f1.png'),
  plane: require('../../assets/icons3d/plane.png'),
  neville: require('../../assets/icons3d/neville.png'),
  desire: require('../../assets/icons3d/desire.png'),
  star: require('../../assets/icons3d/star.png'),
  chart: require('../../assets/icons3d/chart.png'),
  barchart: require('../../assets/icons3d/barchart.png'),
  receipt: require('../../assets/icons3d/receipt.png'),
  advisor: require('../../assets/icons3d/advisor.png'),
  mood1: require('../../assets/icons3d/mood1.png'),
  mood2: require('../../assets/icons3d/mood2.png'),
  mood3: require('../../assets/icons3d/mood3.png'),
  mood4: require('../../assets/icons3d/mood4.png'),
  mood5: require('../../assets/icons3d/mood5.png'),
  sun: require('../../assets/icons3d/sun.png'),
  moon: require('../../assets/icons3d/moon.png'),
  check: require('../../assets/icons3d/check.png'),
  fire: require('../../assets/icons3d/fire.png'),
  steps: require('../../assets/icons3d/steps.png'),
  bell: require('../../assets/icons3d/bell.png'),
  brain: require('../../assets/icons3d/brain.png'),
  notes: require('../../assets/icons3d/notes.png'),
  calendar: require('../../assets/icons3d/calendar.png'),
  notebook: require('../../assets/icons3d/notebook.png'),
  party: require('../../assets/icons3d/party.png'),
  plus: require('../../assets/icons3d/plus.png'),
  sparkles: require('../../assets/icons3d/sparkles.png'),
  bulb: require('../../assets/icons3d/bulb.png'),
  microscope: require('../../assets/icons3d/microscope.png'),
  chess: require('../../assets/icons3d/chess.png'),
  gamepad: require('../../assets/icons3d/gamepad.png'),
  piano: require('../../assets/icons3d/piano.png'),
  basketball: require('../../assets/icons3d/basketball.png'),
  paintbrush: require('../../assets/icons3d/paintbrush.png'),
  telescope: require('../../assets/icons3d/telescope.png'),
  rocket: require('../../assets/icons3d/rocket.png'),
  laptop: require('../../assets/icons3d/laptop.png'),
  puzzle: require('../../assets/icons3d/puzzle.png'),
  globe: require('../../assets/icons3d/globe.png'),
  pen: require('../../assets/icons3d/pen.png'),
  drop: require('../../assets/icons3d/drop.png'),
  target: require('../../assets/icons3d/target.png'),
  trophy: require('../../assets/icons3d/trophy.png'),
  memo: require('../../assets/icons3d/memo.png'),
  link: require('../../assets/icons3d/link.png'),
} as const;

export type Icon3DName = keyof typeof ICONS;

// Icons offered when you add your own study topic or hobby.
export const PICKABLE_ICONS: Icon3DName[] = [
  'sparkles', 'bulb', 'books', 'microscope', 'telescope', 'rocket', 'laptop', 'globe', 'pen',
  'paintbrush', 'piano', 'notes', 'camera', 'chess', 'gamepad', 'basketball', 'puzzle', 'target', 'trophy', 'brain',
];

export function isIcon3D(name: string): name is Icon3DName {
  return name in ICONS;
}

export function Icon3D({ name, size = 40 }: { name: Icon3DName | string; size?: number }) {
  const src = ICONS[(isIcon3D(name) ? name : 'sparkles') as Icon3DName];
  return <Image source={src} style={{ width: size, height: size }} resizeMode="contain" />;
}

// Icon on a soft rounded tile, the app's standard "badge".
export function IconTile({ name, tint, size = 56 }: { name: Icon3DName | string; tint: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2.8,
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon3D name={name} size={size * 0.72} />
    </View>
  );
}
