# Inventory Verification Report — 2026-03-12

## Source
- Excel: `Robot Electrical Architecture v2 (1).xlsx`
- Data repo branch: `v2` (`Kathan-Patel-07/Origin-Hardware-Architecture`)
- Catalog entries checked: 133 files in `catalog/`

---

## Result: All 242 Excel components are catalogued ✓

The Excel architecture file contains **242 unique component instances** across **202 unique base component types**.
All 202 base types are present in the catalog via the `usedAs` field or `nodes/*.json` entries.

---

## 4 Newly Added Catalog Parts (Not in Excel)

These parts were added to the catalog manually but have **no `usedAs` field** set.
They will show Qty/Robot = 0 and won't appear in the Inventory tab correctly.

| Part ID | Part Name | Action Needed |
|---|---|---|
| `cts35un` | CTS35UN | Set `usedAs` to the component name it maps to |
| `spd_2907865` | SPD_2907865 | Set `usedAs` to the component name it maps to |
| `toolchassisv2sanderchassis` | ToolChassisV2SanderChassis | Set `usedAs` to the component name it maps to |
| `tsn3220-10s-u` | TSN3220-10S-U | Set `usedAs` to the component name it maps to |

Fix: open the **Catalog tab** in the app and set the `Used As` column for these 4 parts.

---

## Full Component List (Excel → Catalog mapping)

| Base Component | Qty/Robot | Catalog Part ID |
|---|---|---|
| ACDistributionBlock | 1 | cts10u |
| ACIndicationLight | 1 | 3eplbr5l240ac |
| ACIntraction_US | 1 | 3pin-us-plug-25a |
| ACMCB | 1 | dhmgbspf025 |
| AMR_Bumper (×4) | 4 | aphorism-ae68 |
| AMR_DriverIO_Harness | 1 | customamr_driverio_harness |
| AVB_Fuse | 1 | atm-50a |
| AVB_FuseHolder | 1 | zc-8012-8 |
| ActuationIndicationLight | 1 | 3eplbr348dc |
| ActuationSafetyBoard | 1 | actuationsafety_v10 |
| ActuationVoltageBuck | 1 | sd-1000l24 |
| ActuationVoltageContactor | 1 | aev_250man |
| ActuationVoltageTerminalBlock | 1 | ct35un |
| ActuationVoltage_RC | 1 | custom_rc_earthing_circuit |
| ArmController | 1 | universal-robots-48v-600w |
| ArmONSwitch | 1 | xb5aa31n |
| Arm_Fuse | 1 | atn20a |
| Arm_FuseHolder | 1 | zc-7112b |
| Battery | 1 | newtipower_48v_100ah |
| BatteryDistributionTeminalBlock | 1 | ct35un |
| Battery_Connector | 1 | sb-175a |
| CAN-RS485converter | 1 | waveshare-rs232485422-to-can-industrial-isolated-converter |
| CLBOUT_Fuse | 1 | atn-15a |
| CLBOUT_FuseHolder | 1 | zc-7112b |
| Camera (×8) | 8 | sturdecam25-camera-module (×6) + others |
| CameraAdapter | 1 | sturdecam25_cuoagx-deserializer-board |
| ControlLogicBuck | 1 | ddr-480c-12 |
| ControlLogicTerminalBlock | 1 | cts4u |
| ControlLogic_RC | 1 | custom_rc_earthing_circuit |
| ControllerCompute | 1 | mivi-evoorin |
| ControllerComputeGPIOBoard | 1 | controllercomputegpio_v10 |
| CoolingFan (×7) | 7 | sunon-8025-12vdc-cooling-fan |
| Driver1–6 Fuse | 6 | atn-10a / atn-20a |
| Driver1–6 FuseHolder | 6 | zc-7112b |
| DriverArmDistributionBlock | 1 | cts10u |
| DriverEncoderBattery (×4) | 4 | er14505 |
| E-Stop (×4) | 4 | schneider-xb5as8445 |
| EOACamera_Sander | 1 | tri124s |
| EOACamera_Sprayer | 1 | tri124s |
| EOALightTrigerringSanderBoard | 1 | eoa_lighttrigger_v10 |
| EOALightTrigerringSprayerBoard | 1 | eoa_lighttrigger_v10 |
| EOALightsSander | 1 | xlamp-xhp703 |
| EOALightsSprayer | 1 | xlamp-xhp704 |
| Ethernet_Transceiver (×2) | 2 | 10gbase-t-sfp-copper-100m-rj-45-transceiver-module-for-fs-switches-los |
| F/RL/RR_SteeringMotor | 3 | kinco-fd124s-cb-005 |
| F/RL/RR_SteeringWheelDriver | 3 | fd124-cb-005 |
| F/RL/RR_TravelMotor | 3 | kinco-fd124s-cb-000 |
| F/RL/RR_TravelWheelDriver | 3 | fd124-cb-000 |
| Grounding_wheel | 1 | (mapped) |
| HMI_HDMI | 1 | dh-24-jhdmi2213sx-43-402 |
| HMI_RJ45 | 1 | dh24-rj45 |
| HMI_UsbtypeA (×2) | 2 | dh-24-jusb3213sx-43-401 |
| Hmapper_Battery | 1 | 148v-li-ion-battery |
| Hmapper_Compute | 1 | jetson-orin-nano-devloper-kit |
| Hmapper_Interaction | 1 | 5mm-dc-jack-male |
| Hmapper_Lidar | 1 | airy-96 |
| Hmapper_StepUp | 1 | xl6019e1-boost-converter |
| Hmapper_Switch | 1 | ra1113112r |
| Hmapper_Tab | 1 | galaxy-s9fe-tab |
| Hmapper_TwoCameraSplitter | 1 | sync-stereo-global-shutter-dual-camera-bundle-kit-... |
| IMU | 1 | bno085 |
| Inverter | 1 | meanwell-ntn-5k-248can |
| Lidar (×4) | 4 | airy-96 |
| LiftDriver | 1 | fd145-ab-000 |
| LiftDriverFuse | 1 | atm-40a |
| LiftDriverFuseHolder | 1 | zc-8012-10 |
| LiftDriverReedSwitch | 1 | d-a93 |
| LiftMotor | 1 | kinco-fd145-ab-000 |
| LogicIndicationLight | 1 | 3eplbr1l_s_12 |
| MainFuse | 1 | anm70v-250 |
| MainFuseHolder | 1 | anm-b |
| NEBondingR | 1 | custom_rc_earthing_circuit |
| NavigationSolidstatelidar (×6) | 6 | gs2-ydlidar |
| OStation_* (20 parts) | 1 each | various |
| PLBOUT_Fuse | 1 | atn-20a |
| PLBOUT_FuseHolder | 1 | zc-7112b |
| PerceptionLight (×6) | 6 | customperceptionlight |
| PerceptionLightSSR | 1 | fotek-ssr-25dd |
| PerceptionTerminalBlock | 1 | cts10u |
| PlannerCompute | 1 | agx-orin-devkit |
| PlannerComputeGPIOBoard | 1 | controllercomputegpio_v10 |
| PlannerLogicBuck | 1 | sd-200c-12 |
| PlannerLogicSSR | 1 | fotek-ssr-25dd |
| PlannerSwitch | 1 | tsn3220 |
| RCCB | 1 | dhrgctdf030040 |
| RobotArm | 1 | ur12e |
| SLBOUT_Fuse | 1 | atn-10a |
| SLBOUT_FuseHolder | 1 | zc-7112c |
| SPD | 1 | val-sec-t2-20-48dc-fm |
| SPG bolts (×5) | 5 | custom_spg_bolt |
| SSD_ControlCompute | 1 | 2tb-portable-ssd |
| SafetyLogicBuck | 1 | ddr-240c-24 |
| SafetyLogic_RC | 1 | custom_rc_earthing_circuit |
| Sander_* (23 parts) | 1 each | various |
| Sprayer_* (28 parts) | 1 each | various |
| ToolACInteraction | 1 | 64-100513-01 / 64-200553-01 |
| ToolDC_PowerComms_Interaction | 1 | 59-100413-01 / 59-200453-01 |
| ToolStationDockingLatch (×2) | 2 | 600lbs-electro-magnetic-lockem-lock |
| ToolStationDockingLimitSwitch (×2) | 2 | me-8111-limit-switch |
| TowerLight | 1 | 12v-tower-light-q1-a |
| WirelessRouter | 1 | rutx50 |

---

## Known Issue — Bad Save (PR #93 on data repo)

On 2026-03-12, PR #93 (`chore: update inventory data`, commit `f626ee1`) was merged into
the `v2` branch of the data repo. This commit wiped existing inventory data (337 lines → 7 lines)
because the save was triggered with an empty session state.

**Fix:** Revert PR #93 via the Revert button on GitHub. The app-side save bug has been fixed
(commit `3686c73` on `feat/catalog-gap-detection`) — saves now merge on top of existing data
rather than replacing it.
