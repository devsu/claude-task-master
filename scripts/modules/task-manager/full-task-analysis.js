import fs from 'fs';
import path from 'path';
import { log, findProjectRoot } from '../utils.js';
import parsePRD from './parse-prd.js';
import chalk from 'chalk';
import analyzeTaskComplexity from './analyze-task-complexity.js';
import exportComplexityReport from './export-complexity-report.js';
import { displayComplexityReport } from '../ui.js';

/**
 * Runs a full sequence of parsing a PRD, analyzing complexity with clarification,
 * exporting the final report to CSV, and displaying it.
 * @param {object} options - The command options.
 * @param {string} options.file - Path to the source PRD file.
 * @param {string} options.project - The name of the project.
 * @param {boolean} [options.clarify=false] - Whether to run the interactive clarification step.
 */
async function runFullTaskAnalysis(options = {}) {
    const { file, project, clarify } = options;

    if (!file || !project) {
        log('error', 'Both a PRD file path and a project name are required.');
        return;
    }

    const projectRoot = findProjectRoot();
    if (!projectRoot) {
        log('error', 'Could not determine project root.');
        return;
    }

    try {
        // --- Step 1: Parse PRD ---
        log('info', `[Step 1/4] Starting PRD parsing for project: "${project}"`);
        const tasksFileName = `${project.toLowerCase().replace(/\s+/g, '-')}-tasks.json`;
        const tasksFilePath = path.join(projectRoot, '.taskmaster', 'tasks', tasksFileName);

        let inputFile = file;
        // Check if the file is just a name without any path separators
        if (file && !/[\\/]/.test(file)) {
            const defaultPrdsDir = path.join(projectRoot, '.taskmaster', 'docs', 'prds');
            const assumedPath = path.join(defaultPrdsDir, file);
            if (fs.existsSync(assumedPath)) {
                console.log(chalk.blue(`Filename provided without a path. Assuming location: ${path.relative(projectRoot, assumedPath)}`));
                inputFile = assumedPath;
            }
        }

        const parseResult = await parsePRD(inputFile, tasksFilePath, 10, {
            projectName: project,
            force: true, // Overwrite any existing tasks file for this project
            projectRoot: projectRoot
        });

        if (!parseResult || !parseResult.success) {
            throw new Error('PRD parsing failed. Aborting sequence.');
        }
        log('success', `[Step 1/4] PRD parsed successfully. Tasks saved to: ${tasksFilePath}`);

        // --- Step 2: Analyze Complexity ---
        log('info', `[Step 2/4] Starting complexity analysis for: ${tasksFilePath}`);
        const reportFileName = `task-complexity-report-${project.toLowerCase().replace(/\s+/g, '-')}.json`;
        const reportFilePath = path.join(projectRoot, '.taskmaster', 'reports', reportFileName);

        const analysisOptions = {
            file: tasksFilePath,
            output: reportFilePath,
            clarify: clarify || false, // Pass the clarify flag down
        };
        const analysisResult = await analyzeTaskComplexity(analysisOptions);

        if (!analysisResult || !analysisResult.success) {
            // Handle user abort gracefully
            if (analysisResult.error === 'User aborted analysis.') {
                 log('warn', '[Step 2/4] Full analysis sequence aborted by user.');
                 return;
            }
            throw new Error(`Complexity analysis failed. Aborting sequence. Reason: ${analysisResult.error}`);
        }
        const finalReportPath = analysisResult.data.reportPath;
        log('success', `[Step 2/4] Complexity analysis complete. Report saved to: ${finalReportPath}`);

        // --- Step 3: Export Report ---
        log('info', `[Step 3/4] Exporting complexity report to CSV...`);
        await exportComplexityReport({
            report: finalReportPath,
        });
        log('success', `[Step 3/4] Complexity report exported to CSV.`);
        
        // --- Step 4: Display Report in CLI ---
        log('info', `[Step 4/4] Displaying complexity report in the terminal...`);
        await displayComplexityReport(finalReportPath);
        log('success', `[Step 4/4] Full task analysis sequence completed successfully.`);

    } catch (error) {
        log('error', `The full task analysis sequence failed: ${error.message}`);
    }
}

export default runFullTaskAnalysis;
