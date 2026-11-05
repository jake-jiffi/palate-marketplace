# How the kit's sample media was drawn

The kit demo pages need real assets or they demonstrate their shape rather than their content: a
gallery of grey boxes cannot show whether the gallery is any good, and a video piece stuck on its
poster cannot show that it plays. These three scripts draw everything that ships in
`templates/astro-project/public/images/kit/`.

They are here so the assets can be corrected rather than only replaced. Nothing in this directory
runs during a build, a gate or a scaffold, and none of it reaches a client project.

```
node screens.mjs <out>   # the four Roundhouse screens, for the DemoScreenshots demo
node farm.mjs <out>      # the three Paddockline screens, for the product example page
node art.mjs <out>       # two video posters, six photographic stand-ins, six wordmarks
```

Everything drawn is invented. Roundhouse and Paddockline are not real products, the six wordmarks
are not real firms, and the slots meant to carry photography get a plainly synthetic stand-in
rather than an imitation of a photograph. That last one is the line worth keeping: a slot for a
picture of the client's own work cannot honestly be filled with a fake of one.

## The two videos are not drawn here

`public/media/kit/product-tour.mp4` and `testimonial.mp4` are a slow push-in over a poster frame,
encoded with ffmpeg. The recipe, given a 3840x2160 PNG of the poster:

```
ffmpeg -loop 1 -t 6 -i still.png \
  -vf "zoompan=z='min(zoom+0.00035,1.09)':d=1:x='(iw-iw/zoom)*0.6':y='(ih-ih/zoom)*0.4':s=1280x720:fps=25,fade=t=in:st=0:d=0.6,fade=t=out:st=5.4:d=0.6" \
  -c:v libx264 -pix_fmt yuv420p -crf 28 -preset veryslow -movflags +faststart out.mp4
```

`d=1` is load bearing. It is what makes the zoom accumulate across frames of a looped still
instead of restarting; a larger `d` restarts the zoom on every input frame. The source is
rendered at 3840 wide and scaled down to 720p so zoompan's integer positioning does not read as
jitter. crf 28 holds both files near 50 KB on this kind of flat synthetic content.

## Colour

Each drawing writes `var(--kit-text, #1b1d21)` and friends rather than a bare literal, so an asset
that is ever inlined picks up the brand. Loaded through `<img>`, which is how all of them are used,
an SVG is an isolated document: the custom property does not resolve and the literal after the
comma is what renders. That is why the literals are held near-neutral. An asset cannot read the
accent it would otherwise clash with.
