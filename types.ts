
export interface ConnectionRow {
  SourceComponent: string;
  SourceComponentPartName?: string;
  SourceComponentDatasheetLink?: string;
  DestinationComponent: string;
  DestinationComponentPartName?: string;
  DestinationComponentDatasheetLink?: string;
  ArchitectureType: 'Power' | 'Comm' | 'Safety' | 'Ground' | string;
  FunctionalWireName: string;
  WireSpecifications: string; // Formal notation e.g. "2x 18AWG"
  FunctionalGroup: string;
  SourceComponentCompartment: string;
  DestinationComponentCompartment: string;
  
  // Power Analysis Fields
  AveragePower?: string; // e.g. "50W"
  MaxContinuousPower?: string; // e.g. "100W"
  PeakPower?: string; // e.g. "200W"
  PeakPowerTransientTime?: string; // e.g. "100ms"
  PowerDirection?: 'SD' | 'DS'; // SD = Source->Dest, DS = Dest->Source
  
  Notes: string;
}

export enum ViewType {
  Power = 'Power',
  Comm = 'Comm',
  Safety = 'Safety',
  Spatial = 'Spatial',
  Grounding = 'Grounding',
  Analysis = 'Analysis',
  Guide = 'Guide'
}

export interface DiagramConfig {
  scale: number;
  translateX: number;
  translateY: number;
}
