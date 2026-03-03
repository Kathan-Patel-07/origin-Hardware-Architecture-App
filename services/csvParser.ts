
import { ConnectionRow } from '../types';

export const parseCSV = (csvText: string): ConnectionRow[] => {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
  
  if (lines.length < 2) return [];

  // Assume first row is header. 
  const headers = lines[0].split(',').map(h => h.trim());
  const dataLines = lines.slice(1);

  return dataLines.map(line => {
    // Handle potential simple CSV escaping if needed
    const values = line.split(',');
    
    // Create a safe object
    const row: any = {};
    
    headers.forEach((header, index) => {
      // Remove spaces to match interface keys (e.g. "Source Component" -> "SourceComponent")
      const cleanHeaderKey = header.replace(/ /g, '');
      const value = values[index] ? values[index].trim() : '';
      row[cleanHeaderKey] = value;
    });

    return row as ConnectionRow;
  });
};

export const serializeCSV = (data: ConnectionRow[]): string => {
  if (data.length === 0) return '';
  
  // Define standard headers based on Schema
  const headers = [
    'Source Component', 
    'Source Component Part Name',
    'Source Component Datasheet Link',
    'Destination Component', 
    'Architecture Type', 
    'FunctionalWireName', 
    'WireSpecifications', 
    'FunctionalGroup', 
    'SourceComponentCompartment', 
    'DestinationComponentCompartment',
    'Average Power',
    'Max Continuous Power',
    'Peak Power',
    'Peak Power Transient Time',
    'Power Direction',
    'Notes'
  ];
  
  // Map internal keys to the display headers
  const keyMap: Record<string, keyof ConnectionRow> = {
      'Source Component': 'SourceComponent',
      'Source Component Part Name': 'SourceComponentPartName',
      'Source Component Datasheet Link': 'SourceComponentDatasheetLink',
      'Destination Component': 'DestinationComponent',
      'Architecture Type': 'ArchitectureType',
      'FunctionalWireName': 'FunctionalWireName',
      'WireSpecifications': 'WireSpecifications',
      'FunctionalGroup': 'FunctionalGroup',
      'SourceComponentCompartment': 'SourceComponentCompartment',
      'DestinationComponentCompartment': 'DestinationComponentCompartment',
      'Average Power': 'AveragePower',
      'Max Continuous Power': 'MaxContinuousPower',
      'Peak Power': 'PeakPower',
      'Peak Power Transient Time': 'PeakPowerTransientTime',
      'Power Direction': 'PowerDirection',
      'Notes': 'Notes'
  };

  const headerLine = headers.join(',');
  
  const dataLines = data.map(row => {
    return headers.map(header => {
      const key = keyMap[header];
      const val = row[key] || '';
      // basic escape if contains comma
      return val.includes(',') ? `"${val}"` : val;
    }).join(',');
  });

  return [headerLine, ...dataLines].join('\n');
};
