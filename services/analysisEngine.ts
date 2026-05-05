
import { ConnectionRow } from '../types';

export interface ComponentCoverage {
    id: string;
    partName?: string;
    datasheetLink?: string;
    compartment?: string;
    hasPower: boolean;
    hasComm: boolean;
    hasSafety: boolean;
    hasGround: boolean;
    
    // Power Analysis
    maxContinuousPowerIn: number;
    maxContinuousPowerOut: number;
}

export interface AnalysisResult {
    nodeCount: number;
    totalConnections: number; // Count of valid edges
    connectionCountsByType: Record<string, number>;
    componentCoverage: ComponentCoverage[];
    floatingNodes: string[];
    potentialIslands: string[];
    warnings: string[];
    
    // Readiness Metrics
    missingWireSpecsCount: number;
    missingFunctionalNamesCount: number;
}

// Helper to parse power strings like "100W", "2.5kW", "50"
const parsePowerValue = (val?: string): number => {
    if (!val) return 0;
    const clean = val.toLowerCase().trim();
    
    // Check for units
    if (clean.endsWith('kw')) {
        return parseFloat(clean.replace('kw', '')) * 1000;
    }
    if (clean.endsWith('w')) {
        return parseFloat(clean.replace('w', ''));
    }
    // Assume Watts if no unit
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
};

export const analyzeArchitecture = (data: ConnectionRow[]): AnalysisResult => {
    const nodes = new Set<string>();
    const adjList: Record<string, string[]> = {};
    const warnings: string[] = [];
    const nodeMetadata: Record<string, { partName?: string, datasheetLink?: string, compartment?: string }> = {};
    
    // Track connection counts by type
    const connectionCountsByType: Record<string, number> = {
        Power: 0,
        Comm: 0,
        Safety: 0,
        Ground: 0,
        Other: 0
    };

    let totalConnections = 0;
    let missingWireSpecsCount = 0;
    let missingFunctionalNamesCount = 0;

    // Track types per component
    const compTypes: Record<string, Set<string>> = {};
    
    // Power Flux Tracking
    const powerFlux: Record<string, { in: number, out: number }> = {};

    const getPowerStats = (id: string) => {
        if (!powerFlux[id]) powerFlux[id] = { in: 0, out: 0 };
        return powerFlux[id];
    };

    // 1. Build Graph & Stats & Coverage
    data.forEach(row => {
        const src = row.SourceComponent.trim();
        const dst = row.DestinationComponent?.trim() || ''; // Handle undefined/empty destination
        const spec = row.WireSpecifications?.trim() || 'Unspecified';
        const type = row.ArchitectureType;

        // ONLY count connection if there is a destination
        if (dst) {
            totalConnections++;

            if (type === 'Power' || type === 'Comm' || type === 'Safety' || type === 'Ground') {
                connectionCountsByType[type]++;
            } else {
                connectionCountsByType['Other']++;
            }

            // Readiness Checks for Connections
            if (!row.WireSpecifications || row.WireSpecifications.trim() === '' || row.WireSpecifications.toLowerCase() === 'unspecified') {
                missingWireSpecsCount++;
            }
            if (!row.FunctionalWireName || row.FunctionalWireName.trim() === '') {
                missingFunctionalNamesCount++;
            }
        }

        // Power Flow Analysis
        if (type === 'Power') {
            const watts = parsePowerValue(row.MaxContinuousPower);
            const direction = row.PowerDirection?.toUpperCase() || 'SD'; // Default to Source->Dest
            
            if (watts > 0 && src && dst) {
                const srcStats = getPowerStats(src);
                const dstStats = getPowerStats(dst);

                if (direction === 'SD') {
                    // Source -> Destination
                    srcStats.out += watts;
                    dstStats.in += watts;
                } else if (direction === 'DS') {
                    // Destination -> Source (Reverse flow, e.g. Regen)
                    dstStats.out += watts;
                    srcStats.in += watts;
                }
            }
        }

        if(src) {
            nodes.add(src);
            if (!compTypes[src]) compTypes[src] = new Set();
            // Only add type to source if it's an actual connection. 
            // If it's a definition row (dst is empty), it technically doesn't have a "Power" connection yet from this row.
            // However, keeping it simple: if row says "Power", it's a Power component.
            if (dst) compTypes[src].add(type);

            // Capture Metadata for Source
            if (!nodeMetadata[src]) nodeMetadata[src] = {};
            if (!nodeMetadata[src].partName && row.SourceComponentPartName) {
                nodeMetadata[src].partName = row.SourceComponentPartName;
            }
            if (!nodeMetadata[src].datasheetLink && row.SourceComponentDatasheetLink) {
                nodeMetadata[src].datasheetLink = row.SourceComponentDatasheetLink;
            }
            if (!nodeMetadata[src].compartment && row.SourceComponentCompartment) {
                nodeMetadata[src].compartment = row.SourceComponentCompartment;
            }
        }
        if(dst) {
            nodes.add(dst);
            if (!compTypes[dst]) compTypes[dst] = new Set();
            compTypes[dst].add(type);

             // Capture Metadata for Destination
             if (!nodeMetadata[dst]) nodeMetadata[dst] = {};
             if (!nodeMetadata[dst].partName && row.DestinationComponentPartName) {
                 nodeMetadata[dst].partName = row.DestinationComponentPartName;
             }
             if (!nodeMetadata[dst].datasheetLink && row.DestinationComponentDatasheetLink) {
                 nodeMetadata[dst].datasheetLink = row.DestinationComponentDatasheetLink;
             }
             if (!nodeMetadata[dst].compartment && row.DestinationComponentCompartment) {
                 nodeMetadata[dst].compartment = row.DestinationComponentCompartment;
             }
        }

        // Build Adjacency List (Undirected for continuity check)
        if (src && dst) {
            if (!adjList[src]) adjList[src] = [];
            if (!adjList[dst]) adjList[dst] = [];
            adjList[src].push(dst);
            adjList[dst].push(src);

            // Specific Warnings (Only if connected)
            if (row.ArchitectureType === 'Power' && (spec.includes('18AWG') || spec.includes('20AWG') || spec.includes('22AWG'))) {
                const pwr = parsePowerValue(row.MaxContinuousPower);
                if (pwr > 100) {
                     warnings.push(`Potential Hazard: High Power (${pwr}W) detected on thin wire (${spec}) between ${src} and ${dst}`);
                }
            }
        }
    });

    // 2. Identify Leaf Nodes (Terminal points, potential floating grounds if not Ground type)
    const floatingNodes: string[] = [];
    nodes.forEach(node => {
        const neighbors = adjList[node] || [];
        if (neighbors.length === 0) {
            floatingNodes.push(node); // Truly isolated
        }
    });

    // 3. Island Detection (BFS)
    const visited = new Set<string>();
    let islands = 0;
    
    nodes.forEach(node => {
        if (!visited.has(node)) {
            // Only count as island if it has neighbors (is part of a graph)
            // Isolated definition nodes are not "islands" in a connectivity sense, they are just BOM entries.
            const neighbors = adjList[node] || [];
            if (neighbors.length > 0) {
                islands++;
                // BFS traversal
                const queue = [node];
                visited.add(node);
                while (queue.length > 0) {
                    const curr = queue.shift()!;
                    const nbrs = adjList[curr] || [];
                    nbrs.forEach(n => {
                        if (!visited.has(n)) {
                            visited.add(n);
                            queue.push(n);
                        }
                    });
                }
            }
        }
    });

    if (islands > 1) {
        warnings.push(`Discontinuity Detected: System has ${islands} completely separate islands.`);
    }

    // 4. Generate Coverage Array
    const componentCoverage: ComponentCoverage[] = Array.from(nodes).sort().map(id => {
        const types = compTypes[id] || new Set();
        const meta = nodeMetadata[id] || {};
        const pwr = powerFlux[id] || { in: 0, out: 0 };

        return {
            id,
            partName: meta.partName,
            datasheetLink: meta.datasheetLink,
            compartment: meta.compartment,
            hasPower: types.has('Power'),
            hasComm: types.has('Comm'),
            hasSafety: types.has('Safety'),
            hasGround: types.has('Ground'),
            maxContinuousPowerIn: pwr.in,
            maxContinuousPowerOut: pwr.out
        };
    });

    return {
        nodeCount: nodes.size,
        totalConnections,
        connectionCountsByType,
        componentCoverage,
        floatingNodes,
        potentialIslands: [], 
        warnings,
        missingWireSpecsCount,
        missingFunctionalNamesCount
    };
};
