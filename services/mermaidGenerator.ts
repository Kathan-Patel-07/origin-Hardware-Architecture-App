
import { ConnectionRow, ViewType } from '../types';
import { THEME_COLORS } from '../constants';

// ID Sanitizer
const sanitizeId = (str: string): string => {
  if (!str) return 'Unknown_Node';
  const clean = str.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^\d/.test(clean) ? `N_${clean}` : clean;
};

// Label Escaper
const escapeLabel = (str: string): string => {
  if (!str) return '""';
  const escaped = str.replace(/"/g, '\\"');
  return `"${escaped}"`;
};

export const generateMermaidCode = (
  data: ConnectionRow[], 
  view: ViewType, 
  showWireSpecs: boolean = false,
  focusComponent?: string,
  restrictToSelection?: string[]
): string => {
  // 1. Filter Edges based on View AND Validity (Must have destination)
  let edgesToRender = data.filter(row => {
    // Exclude rows where destination is empty (Definition Rows)
    if (!row.DestinationComponent || row.DestinationComponent.trim() === '') return false;

    switch (view) {
      case ViewType.Power: return row.ArchitectureType === 'Power';
      case ViewType.Comm: return row.ArchitectureType === 'Comm';
      case ViewType.Safety: return row.ArchitectureType === 'Safety';
      case ViewType.Grounding: return row.ArchitectureType === 'Ground';
      case ViewType.Spatial: return true; 
      default: return true;
    }
  });

  // 2. Strict Filtering for Selection OR Focus
  // If restrictToSelection is provided, we ONLY show edges where BOTH ends are in the selection.
  if (restrictToSelection && restrictToSelection.length > 0) {
      const allowed = new Set(restrictToSelection.map(s => s.trim()));
      edgesToRender = edgesToRender.filter(row => 
          allowed.has(row.SourceComponent.trim()) && allowed.has(row.DestinationComponent.trim())
      );
  } else if (focusComponent) {
      // Focus Logic (Legacy/Tooltip)
      const cleanFocus = focusComponent.trim();
      edgesToRender = edgesToRender.filter(row => 
          row.SourceComponent.trim() === cleanFocus || 
          row.DestinationComponent.trim() === cleanFocus
      );
  }

  // Handle case where no edges exist but we might have isolated selected nodes
  const hasEdges = edgesToRender.length > 0;
  const hasSelection = restrictToSelection && restrictToSelection.length > 0;

  if (!hasEdges && !hasSelection) {
    return 'flowchart TB\n    Empty["No Data for this View"]';
  }

  // --- CONFIGURATION ---
  const initCode = `%%{init: {
    "flowchart": { 
        "curve": "step", 
        "nodeSpacing": 50, 
        "rankSpacing": 80, 
        "padding": 20
    },
    "theme": "base",
    "themeVariables": {
        "primaryColor": "#ffffff",
        "primaryTextColor": "#000000",
        "primaryBorderColor": "#000000",
        "lineColor": "#000000",
        "tertiaryColor": "#f3f4f6",
        "fontSize": "13px"
    }
  }}%%\n`;

  let code = `${initCode}flowchart TB\n`;

  // --- STYLING ---
  const blockStyle = `fill:#ffffff,stroke:#000000,stroke-width:1px,color:#000000,rx:0,ry:0`; 
  
  code += `    classDef default ${blockStyle};\n`;
  code += `    classDef bus fill:#ffffff,stroke:#000000,stroke-width:3px,color:#000000,rx:0,ry:0;\n`;
  code += `    classDef groupStyle fill:none,stroke:#94a3b8,stroke-width:1px,stroke-dasharray: 4 4,color:#64748b;\n`;
  code += `    classDef focusNode fill:#fef08a,stroke:#eab308,stroke-width:2px,color:#000000;\n`;

  // --- DATA PROCESSING (Nodes & Groups) ---
  const nodeGroupCounts: Record<string, Record<string, number>> = {};
  const nodesToRender = new Set<string>();

  // Identify which nodes to include
  if (restrictToSelection && restrictToSelection.length > 0) {
      // Explicit selection: Include these nodes even if they have no edges in the view
      restrictToSelection.forEach(id => nodesToRender.add(sanitizeId(id.trim())));
  } else {
      // Implicit selection: Include nodes found in the edges
      edgesToRender.forEach(row => {
          nodesToRender.add(sanitizeId(row.SourceComponent));
          nodesToRender.add(sanitizeId(row.DestinationComponent));
      });
  }

  // Scan FULL data to determine the best group for the nodes we are rendering.
  // We cannot rely on 'edgesToRender' for grouping because it might be empty (isolated nodes)
  // or filtered by view (missing spatial context).
  data.forEach(row => {
      // Skip definition rows for grouping context if dst is missing (though src grouping still valid)
      const srcRaw = row.SourceComponent;
      const dstRaw = row.DestinationComponent || '';
      const srcSan = sanitizeId(srcRaw);
      const dstSan = sanitizeId(dstRaw);

      const updateStats = (nodeId: string, isSrc: boolean) => {
          if (!nodesToRender.has(nodeId)) return;

          let group = 'Ungrouped';
          if (view === ViewType.Spatial) {
             const comp = isSrc ? row.SourceComponentCompartment : row.DestinationComponentCompartment;
             group = comp ? sanitizeId(comp) : 'External';
          } else {
             group = row.FunctionalGroup ? sanitizeId(row.FunctionalGroup) : 'Ungrouped';
          }

          if (!nodeGroupCounts[nodeId]) nodeGroupCounts[nodeId] = {};
          if (!nodeGroupCounts[nodeId][group]) nodeGroupCounts[nodeId][group] = 0;
          nodeGroupCounts[nodeId][group]++;
      };

      updateStats(srcSan, true);
      if (dstRaw) updateStats(dstSan, false);
  });

  // Assign Nodes to Groups
  const clusters: Record<string, Set<string>> = {};
  nodesToRender.forEach(node => {
      // Default to Ungrouped if not found in data (e.g. new node)
      let bestGroup = 'Ungrouped';
      const counts = nodeGroupCounts[node];
      
      if (counts) {
          let maxScore = -1;
          Object.entries(counts).forEach(([grp, score]) => {
              if (score > maxScore) {
                  maxScore = score;
                  bestGroup = grp;
              }
          });
      }

      if (!clusters[bestGroup]) clusters[bestGroup] = new Set();
      clusters[bestGroup].add(node);
  });

  // --- RENDER NODES ---
  Object.entries(clusters).forEach(([groupName, nodeSet]) => {
      if (groupName !== 'Ungrouped') {
          code += `    subgraph ${groupName} ["${groupName.replace(/_/g, ' ')}"]\n`;
          code += `      direction TB\n`;
          nodeSet.forEach(nodeId => {
              code += `      ${nodeId}["${escapeLabel(nodeId)}"]\n`;
          });
          code += `    end\n`;
      } else {
          nodeSet.forEach(nodeId => {
              code += `    ${nodeId}["${escapeLabel(nodeId)}"]\n`;
          });
      }
  });

  // Add styles for groups after
  Object.keys(clusters).forEach(groupName => {
      if (groupName !== 'Ungrouped') {
          code += `    class ${groupName} groupStyle;\n`;
      }
  });

  // --- RENDER CONNECTIONS ---
  let linkIndex = 0;
  const linkStyles: string[] = [];
  
  edgesToRender.forEach(row => {
    const src = sanitizeId(row.SourceComponent);
    const dst = sanitizeId(row.DestinationComponent);
    
    const labelText = showWireSpecs && row.WireSpecifications 
      ? `${row.FunctionalWireName} [${row.WireSpecifications}]` 
      : row.FunctionalWireName;

    const label = labelText ? `|"${escapeLabel(labelText).replace(/"/g, '')}"|` : '';
    
    code += `    ${src} ---${label} ${dst}\n`;

    let color = THEME_COLORS.neutral;
    const type = row.ArchitectureType?.toLowerCase() || '';
    
    if (type === 'power') color = THEME_COLORS.power;
    else if (type === 'comm') color = THEME_COLORS.comm;
    else if (type === 'safety') color = THEME_COLORS.safety;
    else if (type === 'ground') color = THEME_COLORS.ground;

    linkStyles.push(`    linkStyle ${linkIndex} stroke:${color},stroke-width:2px,fill:none;`);
    linkIndex++;
  });

  // Apply Node Styles
  nodesToRender.forEach(nodeId => {
      if (focusComponent && sanitizeId(focusComponent.trim()) === nodeId) {
          code += `    class ${nodeId} focusNode;\n`;
      } else if (nodeId.toLowerCase().includes('bus')) {
          code += `    class ${nodeId} bus;\n`;
      } else {
          code += `    class ${nodeId} default;\n`;
      }
  });

  code += '\n' + linkStyles.join('\n');

  return code;
};
