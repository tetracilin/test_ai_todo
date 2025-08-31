
import React, { useState, useMemo } from 'react';
import { useTasks } from '../context/TaskContext';
import { Decision, KnowledgeGap, WorkPackage, ItemType } from '../types';
import { WorkPackageIcon } from './icons/ProjectIcon';

// --- Layout Constants ---
const DECISION_WIDTH = 240;
const DECISION_HEIGHT = 120;
const KG_WP_WIDTH = 220;
const KG_WP_HEIGHT = 40;
const HORIZONTAL_GAP = 50;
const VERTICAL_GAP = 80;
const KG_VERTICAL_SPACING = 10;


// --- Node and Connector Types ---
interface LayoutNode {
    id: string;
    type: 'decision' | 'knowledgeGap' | 'workPackage';
    x: number;
    y: number;
    width: number;
    height: number;
    data: Decision | KnowledgeGap | WorkPackage;
    decisionId: string; // ID of the parent decision for all node types
}

interface Connector {
    id: string;
    path: string;
    type: 'parent-child' | 'decision-kg' | 'kg-wp';
}

// --- Layout Calculation ---
const calculateLayout = (
    decisionRoots: Decision[], 
    allDecisions: Map<string, Decision>, 
    workPackages: Map<string, WorkPackage>
): { nodes: LayoutNode[], connectors: Connector[], width: number, height: number } => {
    
    const layoutNodes: LayoutNode[] = [];
    const connectors: Connector[] = [];
    let currentY = 0;
    let maxWidth = 0;

    const decisionLayouts = new Map<string, {x: number, y: number, width: number, subtreeWidth: number}>();

    // Post-order traversal to calculate subtree widths and initial x
    function firstPass(decision: Decision, depth: number): number {
        const children = (decision.id ? Array.from(allDecisions.values()).filter(d => d.parentId === decision.id) : []);
        
        let subtreeWidth = 0;
        if (children.length === 0) {
            subtreeWidth = DECISION_WIDTH;
        } else {
            children.forEach(child => {
                subtreeWidth += firstPass(child, depth + 1);
            });
            subtreeWidth += HORIZONTAL_GAP * (children.length - 1);
        }
        
        const myLayout = { x: 0, y: depth * (DECISION_HEIGHT + VERTICAL_GAP), width: DECISION_WIDTH, subtreeWidth };
        decisionLayouts.set(decision.id, myLayout);
        
        return myLayout.subtreeWidth;
    }

    // Pre-order traversal to set final positions
    function secondPass(decision: Decision, parentX: number) {
        const children = (decision.id ? Array.from(allDecisions.values()).filter(d => d.parentId === decision.id) : []);
        const myLayout = decisionLayouts.get(decision.id)!;
        
        myLayout.x = parentX;
        
        if (children.length > 0) {
            let childrenTotalWidth = children.reduce((sum, c) => sum + decisionLayouts.get(c.id)!.subtreeWidth, 0) + HORIZONTAL_GAP * (children.length - 1);
            let childX = myLayout.x - childrenTotalWidth / 2;

            children.forEach(child => {
                const childLayout = decisionLayouts.get(child.id)!;
                secondPass(child, childX + childLayout.subtreeWidth / 2);
                childX += childLayout.subtreeWidth + HORIZONTAL_GAP;
            });
        }
    }

    // Process each root
    let currentX = 0;
    for (const root of decisionRoots) {
        const rootSubtreeWidth = firstPass(root, 0);
        secondPass(root, currentX + rootSubtreeWidth / 2);
        currentX += rootSubtreeWidth + HORIZONTAL_GAP * 2;
    }
    
    // Create final nodes and connectors from layout calculations
    let totalHeight = 0;
    for(const [decisionId, layout] of decisionLayouts.entries()) {
        const decision = allDecisions.get(decisionId)!;

        // Add Decision Node
        layoutNodes.push({
            id: decision.id,
            type: 'decision',
            x: layout.x,
            y: layout.y,
            width: DECISION_WIDTH,
            height: DECISION_HEIGHT,
            data: decision,
            decisionId: decision.id,
        });
        
        maxWidth = Math.max(maxWidth, layout.x + DECISION_WIDTH / 2);
        currentY = layout.y + DECISION_HEIGHT;
        
        // Add Knowledge Gap and Work Package Nodes below
        let kgY = currentY + VERTICAL_GAP / 2;
        if (decision.knowledgeGaps && decision.knowledgeGaps.length > 0) {
            for (const kg of decision.knowledgeGaps) {
                const kgNode: LayoutNode = {
                    id: kg.id,
                    type: 'knowledgeGap',
                    x: layout.x,
                    y: kgY,
                    width: KG_WP_WIDTH,
                    height: KG_WP_HEIGHT,
                    data: kg,
                    decisionId: decision.id
                };
                layoutNodes.push(kgNode);
                
                // Connector from Decision to KG
                connectors.push({
                    id: `${decision.id}-${kg.id}`,
                    type: 'decision-kg',
                    path: `M ${layout.x} ${layout.y + DECISION_HEIGHT/2} L ${layout.x} ${kgY - KG_WP_HEIGHT/2}`
                });

                kgY += KG_WP_HEIGHT + KG_VERTICAL_SPACING;

                if (kg.convertedToWpId && workPackages.has(kg.convertedToWpId)) {
                    const wp = workPackages.get(kg.convertedToWpId)!;
                    const wpNode: LayoutNode = {
                        id: wp.id,
                        type: 'workPackage',
                        x: layout.x,
                        y: kgY,
                        width: KG_WP_WIDTH,
                        height: KG_WP_HEIGHT,
                        data: wp,
                        decisionId: decision.id,
                    };
                    layoutNodes.push(wpNode);

                     // Connector from KG to WP
                    connectors.push({
                        id: `${kg.id}-${wp.id}`,
                        type: 'kg-wp',
                        path: `M ${layout.x} ${kgNode.y + KG_WP_HEIGHT / 2} L ${layout.x} ${wpNode.y - KG_WP_HEIGHT / 2}`
                    });
                     kgY += KG_WP_HEIGHT + KG_VERTICAL_SPACING;
                }
            }
        }
        totalHeight = Math.max(totalHeight, kgY);
        
        // Add Parent-Child Connectors
        if (decision.parentId && decisionLayouts.has(decision.parentId)) {
            const parentLayout = decisionLayouts.get(decision.parentId)!;
            const startX = parentLayout.x;
            const startY = parentLayout.y + DECISION_HEIGHT / 2;
            const endX = layout.x;
            const endY = layout.y - DECISION_HEIGHT / 2;
            const midY = startY + VERTICAL_GAP / 2;

            connectors.push({
                id: `${decision.parentId}-${decision.id}`,
                type: 'parent-child',
                path: `M ${startX},${startY} C ${startX},${midY} ${endX},${midY} ${endX},${endY}`
            });
        }
    }
    
    return { nodes: layoutNodes, connectors, width: maxWidth + HORIZONTAL_GAP, height: totalHeight + VERTICAL_GAP };
};


export const DecisionManagementView: React.FC<{
    selectedItemId: string | null;
    onSelectItem: (id: string) => void;
    onAddItem: () => void;
    setActiveView: (view: string) => void;
}> = ({ selectedItemId, onSelectItem, onAddItem, setActiveView }) => {
    const { getDecisions, getProjects, getItems } = useTasks();
    const allDecisions = getDecisions();
    const projects = getProjects();
    const allWorkPackages = useMemo(() => new Map(getItems().filter((i): i is WorkPackage => i.type === ItemType.WorkPackage).map(wp => [wp.id, wp])), [getItems]);
    
    const [projectFilter, setProjectFilter] = useState<string>('all');

    const diagramData = useMemo(() => {
        const filteredDecisions = projectFilter === 'all' 
            ? allDecisions 
            : allDecisions.filter(d => d.projectId === projectFilter);
        
        const decisionMap = new Map(filteredDecisions.map(d => [d.id, d]));
        const roots = filteredDecisions.filter(d => !d.parentId || !decisionMap.has(d.parentId));

        if (roots.length === 0) return { nodes: [], connectors: [], width: 0, height: 0 };
        
        return calculateLayout(roots, decisionMap, allWorkPackages);

    }, [allDecisions, projectFilter, allWorkPackages]);
    
    const handleNodeClick = (node: LayoutNode) => {
        if (node.type === 'workPackage') {
            setActiveView(`workPackage/${node.id}`);
            onSelectItem(node.id);
        } else {
            onSelectItem(node.decisionId);
        }
    };
    
    // SVG text wrapping utility
    const wrapText = (text: string, maxWidth: number) => {
        if (!text) return [];
        const words = text.split(' ');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine + " " + word;
            // This is a rough estimate; a real implementation would measure text width.
            if (testLine.length > maxWidth / 8) { // Heuristic
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        lines.push(currentLine);
        return lines;
    };


    return (
        <div className="flex-1 flex flex-col overflow-hidden p-4 md:p-6 space-y-4">
            <div className="flex-shrink-0">
                <label htmlFor="project-filter" className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">Filter by Project:</label>
                <select id="project-filter" value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="mt-1 block w-full md:w-1/3 p-2 bg-surface dark:bg-surface-dark rounded-md border border-border-light dark:border-border-dark focus:ring-primary focus:border-primary">
                    <option value="all">All Projects</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            </div>
            
            <div className="flex-1 w-full h-full bg-dots dark:bg-dots-dark rounded-lg border border-border-light dark:border-border-dark overflow-auto">
                <style>{`
                    .bg-dots { background-image: radial-gradient(circle at 1px 1px, #d1d5db 1px, transparent 0); background-size: 20px 20px; }
                    .dark .bg-dots-dark { background-image: radial-gradient(circle at 1px 1px, #4b5563 1px, transparent 0); background-size: 20px 20px; }
                    .connector-path { stroke: #9ca3af; stroke-width: 1.5px; fill: none; }
                    .dark .connector-path { stroke: #6b7280; }
                    .kg-connector-path { stroke-dasharray: 4 2; }
                `}</style>
                {diagramData.nodes.length > 0 ? (
                    <svg width={diagramData.width} height={diagramData.height}>
                        <defs>
                            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" className="dark:fill-[#6b7280]" />
                            </marker>
                        </defs>
                        
                        {/* Connectors */}
                        {diagramData.connectors.map(c => (
                            <path key={c.id} d={c.path} className={`connector-path ${c.type !== 'parent-child' ? 'kg-connector-path' : ''}`} markerEnd={c.type === 'parent-child' ? 'url(#arrow)' : ''} />
                        ))}

                        {/* Nodes */}
                        {diagramData.nodes.map(node => {
                            const isSelected = selectedItemId === node.id || (node.type !== 'decision' && selectedItemId === node.decisionId);
                            const textLines = wrapText((node.data as any).title, node.width - 20);
                            
                            return (
                                <g key={node.id} transform={`translate(${node.x - node.width/2}, ${node.y - node.height/2})`} onClick={() => handleNodeClick(node)} className="cursor-pointer group">
                                    {node.type === 'decision' && (
                                        <>
                                            <path d={`M ${node.width/2} 0 L ${node.width} ${node.height/2} L ${node.width/2} ${node.height} L 0 ${node.height/2} Z`}
                                                  className={`transition-all duration-150 group-hover:stroke-primary ${isSelected ? 'stroke-primary' : 'stroke-gray-400 dark:stroke-gray-500'}`}
                                                  fill="hsl(var(--surface))" strokeWidth="2"/>
                                            <text x={node.width/2} y={node.height/2} textAnchor="middle" dominantBaseline="central" className="fill-text-primary dark:fill-text-primary-dark font-semibold text-sm select-none">
                                                {textLines.map((line, i) => (
                                                    <tspan key={i} x={node.width / 2} dy={i === 0 ? `-${(textLines.length - 1) * 0.5}em` : '1.2em'}>{line}</tspan>
                                                ))}
                                            </text>
                                        </>
                                    )}
                                    {(node.type === 'knowledgeGap' || node.type === 'workPackage') && (
                                        <>
                                            <rect width={node.width} height={node.height} rx="8" ry="8"
                                                className={`transition-all duration-150 group-hover:stroke-primary ${isSelected ? 'stroke-primary' : 'stroke-gray-400 dark:stroke-gray-500'}`}
                                                fill={node.type === 'workPackage' ? 'hsl(var(--background))' : 'hsl(var(--surface))'}
                                                strokeWidth="1.5"
                                                strokeDasharray={node.type === 'knowledgeGap' ? '4 2' : ''} />

                                            <g transform="translate(10, 10)">
                                                {node.type === 'workPackage' && <WorkPackageIcon className="w-4 h-4 text-secondary dark:text-text-secondary-dark" />}
                                            </g>
                                            
                                            <text x={node.type === 'workPackage' ? 32 : 15} y={node.height / 2} dominantBaseline="central" className="fill-text-primary dark:fill-text-primary-dark text-xs select-none">
                                                {(node.data as any).title}
                                            </text>
                                        </>
                                    )}
                                </g>
                            )
                        })}
                    </svg>
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <p className="text-text-secondary dark:text-text-secondary-dark">
                            {projectFilter === 'all' ? 'No decisions found.' : 'No decisions for this project.'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
