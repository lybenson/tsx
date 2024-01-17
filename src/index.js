#!/usr/bin/env node

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import minimist from 'minimist'
import { red, reset } from 'kolorist'
import prompts from 'prompts'
import {
  formatTargetDir,
  isEmpty,
  isValidPackageName,
  toValidPackageName,
  write,
  writeContent,
  pkgFromUserAgent,
  isGitPackage
} from './utils.js'
import { DEFAULT_TARGET_DIR } from './const.js'
import shell from './shell.js'

const argv = minimist(process.argv.slice(2), { string: ['_'] })

// current working directory
const cwd = process.cwd()

// main function
async function main() {
  let targetDir = formatTargetDir(argv._[0]) || DEFAULT_TARGET_DIR

  const getProjectName = () => {
    return targetDir === '.' ? path.basename(path.resolve()) : targetDir
  }

  const questions = [
    {
      type: targetDir !== DEFAULT_TARGET_DIR ? null : 'text',
      name: 'projectName',
      message: reset('Project name:'),
      initial: DEFAULT_TARGET_DIR,
      onState: (state) => {
        targetDir = formatTargetDir(state.value) || DEFAULT_TARGET_DIR
      }
    },
    {
      type: () =>
        !fs.existsSync(targetDir) || isEmpty(targetDir) ? null : 'confirm',
      name: 'overwrite',
      message: () => {
        return (
          (targetDir === '.'
            ? 'Current directroy'
            : `Target directory "${targetDir}"`) +
          ` is not empty. Some files may be overwritten. Do you want to continue?`
        )
      }
    },
    {
      type: (_, { overwrite } = {}) => {
        // choice no for overwrite
        if (overwrite === false) {
          throw new Error(red('✖') + ' Operation cancelled')
        }
        return null
      },
      name: 'overwriteChecker'
    },
    {
      type: (targetDir) => {
        const root = path.join(cwd, targetDir)
        return isGitPackage(root) ? null : 'confirm'
      },
      name: 'isGit',
      initial: 'y',
      message: 'Is it a git project? husky will be used if yes.',
      when: () => true
    },
    {
      type: () => (isValidPackageName(getProjectName()) ? null : 'text'),
      name: 'packageName',
      message: reset('Package name: '),
      initial: () => toValidPackageName(getProjectName()),
      validate: (dir) => {
        return isValidPackageName(dir) || 'Invalid package.json name'
      }
    }
  ]

  let result = {}
  try {
    result = await prompts(questions, {
      onCancel: () => {
        throw new Error(red('✖') + ' Operation cancelled')
      }
    })
  } catch (cancelled) {
    return
  }
  const { packageName, isGit } = result

  let templateName = 'template'

  console.log('cwd', cwd)
  // get project root dir
  const root = path.join(cwd, targetDir)
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })

  const isGitProject = isGitPackage(targetDir) || isGit
  if (isGitProject) {
    shell.exec(`cd ${root} && git init`)
  }

  const templateDir = path.resolve(
    fileURLToPath(import.meta.url),
    '../..',
    templateName
  )

  const files = fs.readdirSync(templateDir)

  // write all files to root dir
  for (const file of files) {
    // if git package .huasky and .commitlintrc.cjs will be ignore
    if (
      !isGitProject &&
      (file === '.husky' ||
        file === '.commitlintrc.cjs' ||
        file === '.gitignore')
    )
      continue
    write(templateDir, root, file)
  }

  // write package.json
  const pkg = JSON.parse(
    fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8')
  )
  if (!isGitProject) {
    delete pkg.scripts
    delete pkg['lint-staged']
    delete pkg.devDependencies['@commitlint/cli']
    delete pkg.devDependencies['@commitlint/config-conventional']
    delete pkg.devDependencies['husky']
    delete pkg.devDependencies['lint-staged']
  }

  pkg.name = packageName || getProjectName()
  writeContent(root, 'package.json', JSON.stringify(pkg, null, 2))

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent)
  const pkgManager = pkgInfo ? pkgInfo.name : 'bun'

  console.log(`\nDone. Now run:\n`)

  if (root !== cwd) {
    console.log(`  cd ${path.relative(cwd, root)}`)
  }

  try {
    shell.exec(`cd ${path.relative(cwd, root)}`)
  } catch (error) {
    console.error(error)
  }

  switch (pkgManager) {
    case 'yarn':
      console.log('  yarn')
      break
    default:
      console.log(`  ${pkgManager} i\n`)

      break
  }
}

main().catch((e) => {
  console.error(e)
})
