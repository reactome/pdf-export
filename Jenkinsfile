// This Jenkinsfile is used by Jenkins to run the 'PDFExport' step of Reactome's release: the
// release's book, TheReactomeBook.pdf.tgz (README, "The release's book"), in place of the
// 'EventPDF' step. It requires that the 'DiagramConverter' step has been run successfully
// before it can be run.
//
// The figures are drawn by WebsiteAngular's render service, reading this release's files and
// drawing from a content service of this release. Where those two run for the release is the
// release's to set (spec 001 T039): their addresses come from Jenkins, as RENDER_SERVICE and
// CONTENT_SERVICE, and the step stops before it starts without them.

import org.reactome.release.jenkins.utilities.Utilities

// Shared library maintained at 'release-jenkins-utils' repository.
def utils = new Utilities()
pipeline{
	agent any

	environment {
		WORK_FOLDER = "work"
		BOOK_FOLDER = "TheReactomeBook"
		ARCHIVE = "TheReactomeBook.pdf.tgz"
		// The website's address, written into the PDFs' links and never fetched.
		SITE = "https://reactome.org"
		ECR_URL = 'public.ecr.aws/reactome/pdf-export'
		CONT_NAME = 'pdf_export_container'
	}

	stages{
		// This stage checks that upstream project 'DiagramConverter' was run successfully.
		stage('Check DiagramConverter build succeeded'){
			steps{
				script{
					utils.checkUpstreamBuildsSucceeded("File-Generation/job/DiagramConverter/")
				}
			}
		}

		stage('Check the render and content services are named'){
			steps{
				script{
					if (!env.RENDER_SERVICE?.trim() || !env.CONTENT_SERVICE?.trim()) {
						error("RENDER_SERVICE and CONTENT_SERVICE must name this release's render service and content service")
					}
				}
			}
		}

		stage('Setup: Pull and clean docker environment'){
			steps{
				sh "docker pull ${ECR_URL}:latest"
				sh """
					if docker ps -a --format '{{.Names}}' | grep -Eq '${CONT_NAME}'; then
						docker rm -f ${CONT_NAME}
					fi
				"""
				// Either run refuses an output folder that is not empty.
				sh "rm -rf ${env.WORK_FOLDER} && mkdir -p ${env.WORK_FOLDER}"
			}
		}

		// Every figure the book prints, drawn through the render service. Exit 1: a fault in the
		// release's data or files, each named; exit 2: a service or the graph cannot be reached.
		stage('Main: Draw the figures'){
			steps{
				script{
					def releaseVersion = utils.getReleaseVersion()
					def releaseFolder = "${env.ABS_DOWNLOAD_PATH}/${releaseVersion}"
					def parallel = env.RENDER_CONCURRENCY ?: "4"
					withCredentials([ usernamePassword(credentialsId: 'neo4jUsernamePassword', passwordVariable: 'neo4jPass', usernameVariable: 'neo4jUser') ])
					{
						sh """\
							docker run --rm \\
							-v ${releaseFolder}:/files:ro \\
							-v \$(pwd)/${env.WORK_FOLDER}:/work \\
							-e NEO4J_URI=bolt://localhost:7687 \\
							-e NEO4J_USER=\$neo4jUser \\
							-e NEO4J_PASSWORD=\$neo4jPass \\
							-u \$(id -u):\$(id -g) \\
							--net=host \\
							--name ${CONT_NAME}_figures \\
							${ECR_URL}:latest \\
							figures --files /files --render ${env.RENDER_SERVICE} --content ${env.CONTENT_SERVICE} \\
							--parallel ${parallel} --out /work/figures --report /work/figures.json
						"""
					}
				}
			}
		}

		// The book, from the graph, the release's folder and the figures: it asks no service, and
		// checks itself (check-book) before it succeeds. About 18 minutes and 6 GB at release 98.
		stage('Main: Make the book'){
			steps{
				script{
					def releaseVersion = utils.getReleaseVersion()
					def releaseFolder = "${env.ABS_DOWNLOAD_PATH}/${releaseVersion}"
					withCredentials([ usernamePassword(credentialsId: 'neo4jUsernamePassword', passwordVariable: 'neo4jPass', usernameVariable: 'neo4jUser') ])
					{
						sh """\
							docker run --rm \\
							-v ${releaseFolder}:/files:ro \\
							-v \$(pwd)/${env.WORK_FOLDER}:/work \\
							-e NEO4J_URI=bolt://localhost:7687 \\
							-e NEO4J_USER=\$neo4jUser \\
							-e NEO4J_PASSWORD=\$neo4jPass \\
							-u \$(id -u):\$(id -g) \\
							--net=host \\
							--name ${CONT_NAME}_book \\
							${ECR_URL}:latest \\
							book --files /files --figures /work/figures --site ${env.SITE} \\
							--out /work/${env.BOOK_FOLDER} --report /work/book.json
						"""
					}
				}
			}
		}

		// The book's files and sizes, kept for comparison at the next release. Its own list
		// (pdf_export), not event-pdf's: the two books' PDFs are not comparable by size.
		stage('Post: Create files and sizes list to upload for next release'){
			steps{
				script{
					def releaseVersion = utils.getReleaseVersion()
					def fileSizeList = "files_and_sizes.txt"
					sh "find ${env.WORK_FOLDER}/${env.BOOK_FOLDER}/ -type f -printf \"%s\t%P\n\" > ${fileSizeList}"
					sh "aws s3 --no-progress cp ${fileSizeList} s3://reactome/private/releases/${releaseVersion}/pdf_export/data/"
					sh "rm ${fileSizeList}"
				}
			}
		}

		// The book's archive, named as event-pdf's is, copied to the downloads folder.
		stage('Post: Generate the book archive and move it to the downloads folder'){
			steps{
				script{
					def releaseVersion = utils.getReleaseVersion()
					dir(env.WORK_FOLDER){
						sh "tar -zcf ${env.ARCHIVE} ${env.BOOK_FOLDER}/"
						sh "cp ${env.ARCHIVE} ${env.ABS_DOWNLOAD_PATH}/${releaseVersion}/"
					}
				}
			}
		}

		// Archive the book and the two runs' reports on S3.
		stage('Post: Archive Outputs'){
			steps{
				script{
					def dataFiles = ["${env.WORK_FOLDER}/${env.ARCHIVE}"]
					def logFiles = ["${env.WORK_FOLDER}/figures.json", "${env.WORK_FOLDER}/book.json"]
					def foldersToDelete = ["${env.WORK_FOLDER}"]
					utils.cleanUpAndArchiveBuildFiles("pdf_export", dataFiles, logFiles, foldersToDelete)
				}
			}
		}
	}
}
