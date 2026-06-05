# Next Control Pace (Garmin Fenix 7X)

A generic Connect IQ data field that shows, between each control: the next
control, distance remaining, segment average speed, ETA, and how many minutes
ahead of or behind plan you are. Install it once and add it to your cycling
activity; it reads whatever StickToThePlan course you load.

## 1. Get the course onto the watch

1. In the web app, download **`course.fit`** (Garmin-klocka section).
2. Copy it to `GARMIN/Courses` on the watch (USB), or import it in Garmin
   Connect and sync. The control points carry their planned time in the name,
   for example `Gränna 07:18`.

## 2. Install the data field

The field ships as a sideloadable `.prg`. Building it once needs the Garmin Connect
IQ SDK with the `fenix7x` device installed:

1. Install the Connect IQ SDK and the SDK Manager (developer.garmin.com). In the SDK
   Manager, sign in with your Garmin account and download the **fenix7x** device.
   `monkeyc` cannot compile for a device whose data has not been downloaded (it fails
   with `Invalid device id: 'fenix7x'`).
2. Build the watch file:

   ```bash
   npm run build:ciq
   ```

   If the SDK or the fenix7x device is missing, the script prints a clear message and
   skips the build instead of failing.

3. Copy `output/NextControlPace.prg` to `GARMIN/Apps` on the watch.

## 3. Add it to your activity

On the watch: cycling profile -> Data Screens -> Add New -> Connect IQ Fields
-> **Next Control Pace** (best as a single full-screen field).

## 4. Ride

Start the course navigation before you start riding. The field starts a new
segment each time you pass a control and shows pace and ETA to the next one.

## Settings

In Connect IQ (Garmin Connect Mobile): layout (Standard / Compact / Fart och
distans / Endast ETA), unit (km/h or mph), and whether to show plan deviation.

Publishing to the Connect IQ Store is tracked in [roadmap.md](roadmap.md).
