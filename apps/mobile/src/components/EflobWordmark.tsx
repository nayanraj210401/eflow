import type { ColorValue } from "react-native";
import { Image } from "react-native";

const EFLOB_LOGO = require("../../assets/eflob-logo.png") as number;

export function EflobWordmark(props: { readonly height: number; readonly color: ColorValue }) {
  return (
    <Image
      accessibilityLabel="eflob"
      resizeMode="contain"
      source={EFLOB_LOGO}
      style={{ height: props.height, width: props.height, tintColor: props.color }}
    />
  );
}
