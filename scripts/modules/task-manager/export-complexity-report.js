import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { readJSON, log, findProjectRoot } from '../utils.js';
// CORRECTED IMPORT PATH:
import { COMPLEXITY_REPORT_FILE } from '../../../src/constants/paths.js';

/**
 * Escapes a field for CSV format. If the field contains a comma, quote, or newline,
 * it will be enclosed in double quotes, and any existing double quotes will be doubled.
 * @param {string|number|null|undefined} field The data to escape.
 * @returns {string} The CSV-safe string.
 */
function escapeCsvField(field) {
    if (field === null || field === undefined) {
        return '';
    }
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        const escapedStr = str.replace(/"/g, '""');
        return `"${escapedStr}"`;
    }
    return str;
}

/**
 * Reads a JSON complexity report and exports it to a well-formatted CSV file.
 * @param {object} options - The command options.
 * @param {string} [options.report] - Path to the source JSON report file.
 * @param {string} [options.output] - Path for the destination CSV file.
 * @param {string} [options.tag] - The tag context for locating the report.
 */
async function exportComplexityReport(options = {}) {
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
        log('error', 'Could not determine project root. Please run `task-master init` first.');
        return;
    }

    // Resolve tag and determine tag-aware report path
    const targetTag = options.tag || 'master';
    const defaultReportPath = options.report || COMPLEXITY_REPORT_FILE;
    const reportPath =
        defaultReportPath === COMPLEXITY_REPORT_FILE && targetTag !== 'master'
            ? defaultReportPath.replace('.json', `_${targetTag}.json`)
            : defaultReportPath;

    const fullReportPath = path.resolve(projectRoot, reportPath);

    // Determine output path
    const defaultOutputPath = fullReportPath.replace('.json', '.csv');
    const outputPath = path.resolve(projectRoot, options.output || defaultOutputPath);
    
    // Check if the report exists
    if (!fs.existsSync(fullReportPath)) {
        log('error', `Complexity report not found at: ${fullReportPath}`);
        log('info', 'Please run `task-master analyze-complexity` first to generate a report.');
        return;
    }

    log('info', `Reading complexity report from: ${fullReportPath}`);

    // Read and parse the JSON report
    const report = readJSON(fullReportPath);
    if (!report || !report.meta || !report.complexityAnalysis) {
        log('error', 'The report file is malformed or empty.');
        return;
    }

    const csvRows = [];

    // 1. Metadata Section
    csvRows.push(['Task Complexity Analysis Report']);
    csvRows.push(['Key', 'Value']);
    csvRows.push(['Generated', new Date(report.meta.generatedAt).toLocaleString()]);
    csvRows.push(['Project', report.meta.projectName]);
    csvRows.push(['Tasks Analyzed', report.meta.tasksAnalyzed]);
    csvRows.push(['Threshold Score', report.meta.thresholdScore]);
    csvRows.push(['Total Estimated Hours', report.meta.totalEstimatedHours]);
    csvRows.push(['Research-backed', report.meta.usedResearch ? 'Yes' : 'No']);
    if (report.meta.clarificationProvided) {
        csvRows.push(['Clarification Used', 'Yes']);
    }
    csvRows.push([]); // Blank row for spacing

    // 2. Complexity Distribution Section
    const sortedTasks = [...report.complexityAnalysis].sort((a, b) => b.complexityScore - a.complexityScore);
    const complexityDistribution = [0, 0, 0]; // Low, Medium, High
    sortedTasks.forEach((task) => {
        if (task.complexityScore < 5) complexityDistribution[0]++;
        else if (task.complexityScore < 8) complexityDistribution[1]++;
        else complexityDistribution[2]++;
    });

    csvRows.push(['Complexity Distribution']);
    csvRows.push(['Level', 'Count', 'Percentage']);
    csvRows.push([
        'Low (1-4)', 
        complexityDistribution[0], 
        `${Math.round((complexityDistribution[0] / sortedTasks.length) * 100)}%`
    ]);
    csvRows.push([
        'Medium (5-7)', 
        complexityDistribution[1], 
        `${Math.round((complexityDistribution[1] / sortedTasks.length) * 100)}%`
    ]);
    csvRows.push([
        'High (8-10)', 
        complexityDistribution[2], 
        `${Math.round((complexityDistribution[2] / sortedTasks.length) * 100)}%`
    ]);
    csvRows.push([]); // Blank row for spacing

    // 3. Complex Tasks Section
    const tasksNeedingExpansion = sortedTasks.filter(
        (task) => task.complexityScore >= report.meta.thresholdScore
    );
    if (tasksNeedingExpansion.length > 0) {
        csvRows.push([`Complex Tasks (Score >= ${report.meta.thresholdScore})`]);
        const complexHeaders = ['ID', 'Title', 'Score', 'Estimate (hrs)', 'Subtasks', 'Expansion Command'];
        csvRows.push(complexHeaders);

        tasksNeedingExpansion.forEach((task) => {
            const expansionCommand = `task-master expand --id=${task.taskId} --num=${task.recommendedSubtasks}${task.expansionPrompt ? ` --prompt="${task.expansionPrompt}"` : ''}`;
            csvRows.push([
                task.taskId,
                task.taskTitle,
                task.complexityScore,
                task.estimatedHours,
                task.recommendedSubtasks,
                expansionCommand
            ]);
        });
        csvRows.push([]); // Blank row for spacing
    }

    // 4. Simple Tasks Section
    const simpleTasks = sortedTasks.filter(
        (task) => task.complexityScore < report.meta.thresholdScore
    );
    if (simpleTasks.length > 0) {
        csvRows.push([`Simple Tasks (Score < ${report.meta.thresholdScore})`]);
        const simpleHeaders = ['ID', 'Title', 'Score', 'Estimate (hrs)', 'Reasoning'];
        csvRows.push(simpleHeaders);

        simpleTasks.forEach((task) => {
            csvRows.push([
                task.taskId,
                task.taskTitle,
                task.complexityScore,
                task.estimatedHours,
                task.reasoning,
            ]);
        });
    }

    // Convert array of arrays to a single CSV string
    const csvContent = csvRows.map(row => row.map(escapeCsvField).join(',')).join('\n');
    
    // Write the CSV file
    try {
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        fs.writeFileSync(outputPath, csvContent, 'utf8');
        log('success', `Successfully exported complexity report to: ${outputPath}`);
    } catch (error) {
        log('error', `Failed to write CSV file: ${error.message}`);
    }
}

export default exportComplexityReport;
