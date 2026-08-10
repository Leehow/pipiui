import Darwin
import Foundation
import PipiPDFCore

let input = FileHandle.standardInput.readDataToEndOfFile()
let result = PDFHelperCommand.execute(inputData: input)
FileHandle.standardOutput.write(result.stdout)
FileHandle.standardOutput.write(Data([0x0A]))
if !result.stderr.isEmpty {
    FileHandle.standardError.write(Data(result.stderr.utf8))
}
exit(result.exitCode.rawValue)
