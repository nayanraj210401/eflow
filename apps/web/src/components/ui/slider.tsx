"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";

import { cn } from "~/lib/utils";

function Slider({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      data-slot="slider"
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full items-center py-2">
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-input">
          <SliderPrimitive.Indicator className="absolute h-full rounded-full bg-primary" />
          <SliderPrimitive.Thumb
            className="block size-4 rounded-full border border-primary bg-background shadow-sm/5 outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-disabled:opacity-64"
            data-slot="slider-thumb"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
