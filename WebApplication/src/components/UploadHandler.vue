<script>
import {readDICOMTags} from 'itk-wasm'
import Uppie from "uppie/uppie.min.js"
import UploadReport from "./UploadReport.vue"
import api from "../orthancApi"


async function isDataAlreayUploaded(file){
  try {
    let tag = await readDICOMTags(null, file, ["0020|000E"]).then(function ({webWorker, arrayBuffer, tags}) {
      webWorker.terminate();
      return tags.get("0020|000E");
    })

    let response = await api.findSeries({"SeriesInstanceUID": tag})
    return response.data.length>0;
  }
  catch(err){
    console.log(file);
    return false
  }


}
// Drop handler function to get all files
async function getAllFileEntries(dataTransferItemList) {
    let fileEntries = [];
    // Use BFS to traverse entire directory/file structure
    let queue = [];
    // Unfortunately dataTransferItemList is not iterable i.e. no forEach
    for (let i = 0; i < dataTransferItemList.length; i++) {
        queue.push(dataTransferItemList[i].webkitGetAsEntry());
    }
    while (queue.length > 0) {
        let entry = queue.shift();
        if (entry.isFile) {
            fileEntries.push(entry);
        } else if (entry.isDirectory) {
            let reader = entry.createReader();
            queue.push(...await readAllDirectoryEntries(reader));
        }
    }
    return fileEntries;
}

async function getFileFromFileEntry(fileEntry) {
    try {
        return await new Promise((resolve, reject) => fileEntry.file(resolve, reject));
    } catch (err) {
        console.log(err);
    }
}

async function getAllFiles(dataTransferItemList) {
    let fileEntries = await getAllFileEntries(dataTransferItemList);

    let files = [];
    for (let fileEntry of fileEntries) {
        files.push(await getFileFromFileEntry(fileEntry));
    }

    return files;
}

// Get all the entries (files or sub-directories) in a directory by calling readEntries until it returns empty array
async function readAllDirectoryEntries(directoryReader) {
    let entries = [];
    let readEntries = await readEntriesPromise(directoryReader);
    while (readEntries.length > 0) {
        entries.push(...readEntries);
        readEntries = await readEntriesPromise(directoryReader);
    }
    return entries;
}

// Wrap readEntries in a promise to make working with readEntries easier
async function readEntriesPromise(directoryReader) {
    try {
        return await new Promise((resolve, reject) => {
            directoryReader.readEntries(resolve, reject);
        });
    } catch (err) {
        console.log(err);
    }
}

function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        let reader = new FileReader();

        reader.onload = () => {
            resolve(reader.result);
        };

        reader.onerror = reject;

        reader.readAsArrayBuffer(file);
    })
}

export default {
    props: [],
    data() {
        return {
            uppie: null,
            uploadCounter: 0,
            lastUploadReports: {},
            processed_directories: []
        };
    },
    mounted() {
        this.uppie = new Uppie();
        //this.uppie(document.querySelector("#filesUpload"), this.uppieUploadHandler);
        this.uppie(document.querySelector("#foldersUpload"), this.uppieUploadHandler);
    },
    methods: {
        onDrop(ev) {
            console.log("on drop", ev);
            ev.preventDefault();

            getAllFiles(ev.dataTransfer.items).then((files) => {
                this.uploadFiles(files);
            });
        },
        onDragOver(event) {
            event.preventDefault();
        },
        onDeletedUploadReport(uploadReportId) {
            delete this.lastUploadReports[uploadReportId];
        },
        async uploadedFile(uploadId, uploadedFileResponse) {
            let studyId = uploadedFileResponse["ParentStudy"];
            if (!this.lastUploadReports[uploadId].uploadedStudiesIds.has(studyId)) {
                this.lastUploadReports[uploadId].uploadedStudiesIds.add(studyId);
                const studyResponse = await api.getStudy(studyId);
                this.lastUploadReports[uploadId].uploadedStudies[studyId] = studyResponse.data;

                this.$store.dispatch('studies/addStudy', { study: studyResponse.data, studyId: studyId });
            }
        },
        async uploadFiles(files) {
            let uploadId = this.uploadCounter++;
            let curDirectory = null;
            this.lastUploadReports[uploadId] = {
                id: uploadId,
                filesCount: files.length,
                successFilesCount: 0,
                failedFilesCount: 0,
                skippedFilesCount: 0,
                uploadedStudiesIds: new Set(),
                uploadedStudies: {},  // studies as returned by tools/find
                errorMessages: {}
            };
            for (let file of files) {

                let filename = file.webkitRelativePath || file.name;
                if (file.name == "DICOMDIR") {
                    console.log("upload: skipping DICOMDIR file");
                    this.lastUploadReports[uploadId].skippedFilesCount++;
                    this.lastUploadReports[uploadId].errorMessages[filename] = "skipped";
                    continue;
                }
                let pathStrSplit = file.webkitRelativePath.split('/')
                let fileName = pathStrSplit.pop()
                let directoryName = pathStrSplit.join('/')
                let retrivedDirectory = this.processed_directories.filter(e => e.directory === directoryName);

                if (retrivedDirectory.length === 0){
                  this.processed_directories.push({
                    directory: directoryName,
                    fileName: fileName,
                    pathStrSplit: pathStrSplit,
                    full: file.webkitRelativePath,
                    uploadIt: !await isDataAlreayUploaded(file)
                  });
                  curDirectory = this.processed_directories[this.processed_directories.length-1];
                }else {
                  curDirectory = retrivedDirectory[0];
                }
                if (curDirectory.uploadIt) {
                  const fileContent = await readFileAsync(file);
                  try {
                    const uploadResponse = await api.uploadFile(fileContent);
                    if (Array.isArray(uploadResponse.data)) { // we have uploaded a zip
                      if (uploadResponse.data.length > 0) {
                        this.lastUploadReports[uploadId].successFilesCount++;
                        for (let uploadFileResponse of uploadResponse.data) {
                          this.uploadedFile(uploadId, uploadFileResponse);
                        }
                      } else {
                        this.lastUploadReports[uploadId].failedFilesCount++;
                        this.lastUploadReports[uploadId].errorMessages[filename] = "no valid DICOM files found in zip";
                      }
                    } else {
                      this.lastUploadReports[uploadId].successFilesCount++;
                      this.uploadedFile(uploadId, uploadResponse.data);
                    }
                  } catch (error) {
                    console.log(error);
                    let errorMessage = "error " + error.response.status;
                    if (error.response.status >= 400 && error.response.status < 500) {
                      errorMessage = error.response.data.Message;
                    }
                    this.lastUploadReports[uploadId].failedFilesCount++;
                    this.lastUploadReports[uploadId].errorMessages[filename] = errorMessage;
                  }
                }
                else{
                  console.log("upload: skipping DICOMDIR file");
                  this.lastUploadReports[uploadId].skippedFilesCount++;
                  this.lastUploadReports[uploadId].errorMessages[filename] = "skipped";
                  continue;
                }
            }
        },
        async uppieUploadHandler(event, formData, files) {
            this.uploadFiles(event.target.files);
        }
    },
    components: { UploadReport }
}
</script>

<template>
    <div>
        <div class="upload-handler-drop-zone" @drop="this.onDrop" @dragover="this.onDragOver">
            <div class="mb-3">{{ $t('drop_files') }}</div>
            <div class="mb-3">
                <label class="btn btn-primary btn-file">
                    {{ $t('select_folder') }} <input type="file" style="display: none;" id="foldersUpload" required
                        multiple directory webkitdirectory allowdirs>
                </label>
            </div>
            <!--<div class="mb-3">
                <label class="btn btn-primary btn-file">
                    {{ $t('select_files') }} <input type="file" style="display: none;" id="filesUpload" required multiple>
                </label>
            </div>-->
        </div>
        <div class="upload-report-list">
            <UploadReport v-for="(upload, key) in lastUploadReports" :report="upload" :key="key"
                @deletedUploadReport="onDeletedUploadReport"></UploadReport>
        </div>
    </div>
</template>
<style scoped>
.upload-report-list {
    display: flex;
    flex-direction: column-reverse;
}

.jobs {
    color: black;
}

.jobs-header {
    text-align: left;
    padding-top: 2px;
    padding-bottom: 2px;
}

.jobs-body {
    padding-top: 2px;
    padding-bottom: 2px;
    line-height: 1.6;
    text-align: left;
}

.jobs-body a {
    color: black;
    text-decoration: underline;
}

.upload-details-errors {
    text-align: left;
    border-bottom: 3px;
    border-top: 0px;
    border-left: 0px;
    border-right: 0px;
    border-color: gray;
    border-style: solid;
}

.job-card {
    margin-bottom: 2px;
}

.job-card-close {
    position: absolute;
    top: 5px;
    right: 5px;
}

.upload-details li {
    border-left: 0px;
    text-align: left;
    border: 0px;
}

.upload-handler-drop-zone {
    border-color: white;
    border-style: dashed;
    border-width: 4px;
}
</style>