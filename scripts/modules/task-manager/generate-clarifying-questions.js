import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { readJSON, findProjectRoot, findTasksJsonPath, log } from '../utils.js';
import { generateTextService } from '../ai-services-unified.js';
import { getProjectName, getDebugFlag } from '../config-manager.js';

async function generateClarifyingQuestions(options, context = {}) {
    const { session, mcpLog } = context;
    // Destructure 'project' from options and rename it to 'projectName'
    const { id, file, output, tasksData, project: projectName } = options;

    const outputFormat = mcpLog ? 'json' : 'text';
    const reportLog = (message, level = 'info') => {
        if (mcpLog) {
            mcpLog[level](message);
        } else if (outputFormat === 'text') {
            log(level, message);
        }
    };

    const debug = getDebugFlag(session);

    if (outputFormat === 'text') {
        console.log(chalk.blue('Generating clarifying questions document...'));
    }

    if ([id, file, tasksData].filter(Boolean).length !== 1) {
        const errorMessage = 'Please provide either a --id (task ID), a --file (PRD path), or tasksData, but not more than one.';
        reportLog(errorMessage, 'error');
        if (outputFormat === 'text') {
            console.error(chalk.red(errorMessage));
        }
        return { success: false, error: errorMessage };
    }

    let contentToClarify = '';
    let documentTitle = '';
    let defaultFileName = '';

    const projectRoot = findProjectRoot();
    if (!projectRoot) {
        const errorMessage = 'Could not determine project root. Please run `task-master init` first.';
        reportLog(errorMessage, 'error');
        if (outputFormat === 'text') {
            console.error(chalk.red(errorMessage));
        }
        return { success: false, error: errorMessage };
    }
    
    const tasksPath = findTasksJsonPath(projectRoot);

    // **UPDATED**: Set the default directory for questions files.
    const defaultQuestionsDir = path.join(projectRoot, '.taskmaster', 'docs', 'questions');
    if (!fs.existsSync(defaultQuestionsDir)) {
        fs.mkdirSync(defaultQuestionsDir, { recursive: true });
    }

    try {
        if (id) {
            const allTasksData = readJSON(tasksPath, projectRoot);
            const taskId = parseInt(id, 10);
            const task = allTasksData.tasks.find(t => t.id === taskId);

            if (!task) {
                const errorMessage = `Task with ID ${id} not found.`;
                reportLog(errorMessage, 'error');
                if (outputFormat === 'text') {
                    console.error(chalk.red(errorMessage));
                }
                return { success: false, error: errorMessage };
            }

            contentToClarify = `Task ID: ${task.id}\nTitle: ${task.title}\nDescription: ${task.description}\nDetails: ${task.details || 'N/A'}\nDependencies: ${task.dependencies?.join(', ') || 'N/A'}\nStatus: ${task.status}`;
            documentTitle = `Clarifying Questions for Task ${task.id}: ${task.title}`;
            defaultFileName = `clarifying_questions_task_${task.id}.md`;
            reportLog(`Analyzing task ${task.id} for clarifying questions...`, 'info');

        } else if (file) {
            const prdFilePath = path.resolve(projectRoot, file); // Resolve relative to project root
            if (!fs.existsSync(prdFilePath)) {
                const errorMessage = `PRD file not found at ${prdFilePath}.`;
                reportLog(errorMessage, 'error');
                if (outputFormat === 'text') {
                    console.error(chalk.red(errorMessage));
                }
                return { success: false, error: errorMessage };
            }
            contentToClarify = fs.readFileSync(prdFilePath, 'utf8');
            
            const prdFileName = path.basename(file, path.extname(file));
            documentTitle = `Clarifying Questions for PRD: ${prdFileName}`;
            defaultFileName = `clarifying_questions_prd_${prdFileName}.md`;
            reportLog(`Analyzing PRD file ${file} for clarifying questions...`, 'info');

        } else if (tasksData && Array.isArray(tasksData.tasks)) {
            const tasksToProcess = tasksData.tasks;
            if (tasksToProcess.length === 0) {
                reportLog('No tasks provided in tasksData for clarifying questions.', 'warn');
                return { success: true, data: { filePath: null, message: 'No tasks to clarify.' } };
            }
            contentToClarify = tasksToProcess.map(t => `Task ID: ${t.id}\nTitle: ${t.title}\nDescription: ${t.description}\nDetails: ${t.details || 'N/A'}`).join('\n\n---\n\n');
            documentTitle = `Clarifying Questions for ${tasksToProcess.length} Task(s)`;
            defaultFileName = `clarifying_questions_for_tasks.md`; 
            reportLog(`Analyzing ${tasksToProcess.length} task(s) for clarifying questions...`, 'info');
        }

        // If a project name is provided, it overrides any default naming.
        if (projectName) {
            documentTitle = `Clarifying Questions for Project: ${projectName}`;
            const sanitizedProjectName = projectName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            defaultFileName = `Clarifying Questions for Project-${sanitizedProjectName}.md`;
            log('info', `Overriding output name based on project: "${projectName}"`);
        }

        const systemPrompt = `You are an expert software architect and technical lead. Your task is to review the provided content (which could be a software development task or a Product Requirements Document - PRD) and generate a list of clarifying questions for a developer.

These questions should help the developer:
- Understand any ambiguities or vague information.
- Explore different implementation options or technical choices.
- Identify missing details or edge cases.
- Ensure a complete analysis before starting work.
- Encourage detailed, actionable answers.

Provide the questions in a clear, numbered list format. Do not include any introductory or concluding remarks, just the numbered list of questions.`;

        const userPrompt = `Content to analyze:\n\n\`\`\`\n${contentToClarify}\n\`\`\`\n\nGenerate a numbered list of clarifying questions:`;

        if (debug) {
            reportLog(`System Prompt:\n${systemPrompt}`, 'debug');
            reportLog(`User Prompt:\n${userPrompt}`, 'debug');
        }

        const aiResponse = await generateTextService({
            prompt: userPrompt,
            systemPrompt: systemPrompt,
            role: 'main', // Use main AI model
            session: session,
            projectRoot: projectRoot,
            commandName: 'clarify',
            outputType: outputFormat
        });

        const questions = aiResponse.mainResult;

        // **UPDATED**: Use the new default directory if no output flag is given.
        const outputFilePath = output ? path.resolve(projectRoot, output) : path.join(defaultQuestionsDir, defaultFileName);

        const documentContent = `# ${documentTitle}\n\n` +
                                `Generated on: ${new Date().toISOString()}\n\n` +
                                `--- \n\n` +
                                `Please fill out the answers to these questions to improve the analysis and planning for this task/PRD.\n\n` +
                                `## Clarifying Questions\n\n` +
                                `${questions}\n\n` +
                                `## Answers\n\n` +
                                `(Developer to fill out answers here)\n\n`;

        fs.writeFileSync(outputFilePath, documentContent, 'utf8');

        reportLog(chalk.green(`Clarifying questions document generated successfully at: ${outputFilePath}`), 'success');
        if (outputFormat === 'text') {
            console.log(chalk.green(`\nDocument saved to: ${outputFilePath}`));
            console.log(chalk.cyan(`\nSuggested next step: Open the document and fill out the answers.`));
        }

        return { success: true, data: { filePath: outputFilePath, title: documentTitle } };

    } catch (error) {
        const errorMessage = `Error generating clarifying questions: ${error.message}`;
        reportLog(errorMessage, 'error');
        if (outputFormat === 'text') {
            console.error(chalk.red(errorMessage));
            if (debug) {
                console.error(error);
            }
        }
        return { success: false, error: errorMessage };
    }
}

export default generateClarifyingQuestions;
