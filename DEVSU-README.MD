# Task Master - Devsu

Based off of the original Task Master project. This document is meant to show you how to use Task Master with the updates worked on for Devsu LLC

## The Updates

### **`clarify` Command** (New)

Generates a document with clarifying questions for a task or a Product Requirements Document (PRD).

**Usage:**  `task-master clarify [options]` 

| Flag|Argument|Description|
|:-:|:-:|:-:|
|`-i`, `--id`|`<id>`|The ID of a specific task you want to clarify.|
|`-f`,`--file`|`<path>`|The path to a PRD file to clarify.|
|`--project`|`<name>`|Sets a project name for the output filename and the document title.|
|`-o`, `--output`|`<path>`|Specifies the exact output file path for the generated document.|

**Note:** If no `--output` path is specified, the generated questions will be saved  to `root/.taskmaster/docs/questions/`

### **`parse-prd` Command** (Update)

Parses a Product Requirements Document (PRD) file and generates a structured list of tasks.

**Usage:** `task-master parse-prd [file] [options]`   

**Updates:** 

Added the new command option `--project` to set a specific Project Name for the `tasks.json` file generated.

| Flag|Argument|Description|
|:-:|:-:|:-:|
|`[file]`|`<path>/<name>`|**Optional.** The path to the PRD file. If not provided, the command looks for a default `prd.md` file.|
|`--project`|`<name>`|Sets a project name for the task metadata and influences the output filename if `-o` is not used.|
---
 - `[file]` now checks if the given path is a complete valid path or just a file name. If only a file name is given, it will look for the prd in `root/.taskmaster/docs/prds/`
 - `--project` will replace the name of the generated tasks file to include the given Project Name and save it into `root/.taskmaster/tasks/`

### **`analyze-complexity` Command** (Update)

Analyzes tasks from a `tasks.json` file to generate a complexity report with scores, estimates, and expansion recommendations.

**Usage:**  `task-master analyze-complexity [options]`

**Updates:** 

Added the new command option `--clarify`. If this flag is sent, then `analyze-complexity` will also run the `clarify` command and generate questions based off of the current tasks. It will then wait for the developer to answer the questions generated. The developer needs to type `"continue"` in the CLI after saving the answers for the bot to continue its analysis work.

| Flag|Argument|Description|
|:-:|:-:|:-:|
|`--clarify`|N/A|**Optional.** Enables an interactive step where the AI generates clarifying questions for complex tasks. The command will pause until you provide answers.|

If no output is defined, the report will be saved to `root/.taskmaster/docs/reports/`. If the corresponding `tasks.json` file contains a Project Name in its metadata, it will use it to define the Project Name both in the report, and in the file name.

### **`export-complexity-report` Command** (New)

Exports a JSON complexity analysis report into a well-formatted CSV file.

**Usage:**  `task-master export-complexity-report [options]`

| Flag|Argument|Description|
|:-:|:-:|:-:|
|`-r`, `--report`|`<path>`|**Optional.** The path to the source JSON report file to convert. Defaults to the standard report path.|
|`-o`, `--output`|`<path>`|**Optional.** Specifies the output file path for the generated CSV file. If not used, the CSV is created in the same directory as the source report.|
|`--tag`|`<tag>`|**Optional.** Specifies a tag to locate the correct report file if you are using multiple tags (e.g., `task-complexity-report_my-feature.json`).|

### **`full-task-analysis` Command** (New)

Runs the full analysis pipeline: 

 1. Parses a PRD
 2. Analyzes its complexity
 3. Exports the report to CSV
 4. Displays it in the terminal.

**Usage:**  `task-master full-task-analysis <file> <project> [options]`

| Argument/Flag|Type|Description|
|:-:|:-:|:-:|
|`<file>`|Argument|**Required.** The path to the source PRD file.|
|`<project>`|Argument|**Required.** The name for the project.|
|`--clarify`|Flag|**Optional.** Enables the interactive clarification step during the complexity analysis.|

**Note:** `<file>` and `<project>` are required because these will be used in the whole analysis flow, sending down the options along the rest of the commands.