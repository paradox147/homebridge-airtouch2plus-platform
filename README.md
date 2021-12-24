# homebridge-airtouch2plus-platform

#### Homebridge plugin for the Airtouch2+ AC Controller

based off the homebridge-airtouch4-platform plugin by mihailescu2m

Note: This is currently in alpha, use at your own risk.

## Installation

1. Install [homebridge](https://github.com/nfarina/homebridge#installation-details)
2. Install this plugin: `npm install -g homebridge-airtouch2plus-platform`
3. Update your `config.json` file (See below).

## Configuration example

```json
"platforms": [
    {
        "platform": "Airtouch2",
        "name": "Airtouch2",
        "ip_address": "192.168.0.10",
        "ac_include_temps": false,
        "units": [
            {
                "manufacturer": "LG",
                "model": "B36AWY-7G6",
                "fan": ["AUTO", "QUIET", "LOW", "MEDIUM"]
            }
        ]
    }
]
```

## Structure

| Key | Description |
| --- | --- |
| `platform` | Must be `Airtouch2` |
| `name` | Name for the platform |
| `ip_address` | Airtouch2 console IP address, can be found under "System Settings" -> "WiFi Settings", click the three-dots icon in the upper right corner, select "Advanced" in the popup menu |
| `ac_include_temps` | Add zone temperature information in the AC accessory page |
| `units` | Array with information about your AC units, containing: |
| `manufacturer` _(optional)_ | Appears under "Manufacturer" for your AC accessory in the Home app |
| `model` _(optional)_ | Appears under "Model" for your AC accessory in the Home app |
| `fan` _(required)_ | List with fan speeds that can be set for your AC |

## Accessories

#### `AC` - created for each AC unit (e.g. `AC 0`, `AC 1`, ...)

It uses the Homekit `Thermostat` service, and can set AC OFF/HEAT/COOL/AUTO and fan speed. DRY/FAN modes appear as AUTO.

There are custom fields such as "Spill Active" and "Timer Set" received from the Airtouch2+ console that are also available only on 3rd party apps.

Thermostat uses FakeGato service for temperature history, available only in the Eve app.

#### `Zone` - created for each Airtouch group (e.g. `Zone 0`, `Zone 1`, ...)

It uses 2 Homekit services:

* `Switch` - to turn the zone ON/OFF.
* `Window` - for damper control. Window in Homekit represents a motorized control that can open/close a window and can be set open to a specific position (in %). This control is the most compatible to the damper percentage control. From the Apple home interface you can set it in 5% increments, the Eve app has options only to "Open" (100%) and "Close" (0%). Damper is being set to the desired value only if zone is set to percentage control type, when using temperature control the Damper shows up as "Obstructed" and cannot be set.
