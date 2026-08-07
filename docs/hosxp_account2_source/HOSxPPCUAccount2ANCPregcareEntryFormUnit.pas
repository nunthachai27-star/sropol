unit HOSxPPCUAccount2ANCPregcareEntryFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxLookAndFeels, cxLookAndFeelPainters, Menus,
  dxSkinsCore, dxSkinsDefaultPainters, StdCtrls, cxButtons, ExtCtrls,
  OneStopServiceDMU,
  JvExControls, JvNavigationPane, cxControls, cxContainer, cxEdit, cxGroupBox,
  DB, DBClient, cxTextEdit, cxDBEdit, cxLabel, cxMaskEdit, cxDropDownEdit,
  cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox, dxSkinscxPCPainter, cxPC,
  cxMemo, cxCheckBox, cxSpinEdit, cxTimeEdit, cxCalendar, dxBarBuiltInMenu,
  JvComponentBase, JvFormPlacement;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2ANCPregcareEntryForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel2: TPanel;
    CloseButton: TcxButton;
    SaveButton: TcxButton;
    DeleteButton: TcxButton;
    LogViewButton: TcxButton;
    PersonANCPregCareCDS: TClientDataSet;
    PersonANCPregCareDS: TDataSource;
    cxPageControl1: TcxPageControl;
    ScreenTabSheet: TcxTabSheet;
    cxTabSheet2: TcxTabSheet;
    DxTabsheet: TcxTabSheet;
    MedicationTabsheet: TcxTabSheet;
    PatientInformationDetailGroupBox: TcxGroupBox;
    PersonANCCDS: TClientDataSet;
    VisitGroupBox: TcxGroupBox;
    ScreenGroupBox: TcxGroupBox;
    cxGroupBox1: TcxGroupBox;
    Label13: TcxLabel;
    cxDBSpinEdit1: TcxDBSpinEdit;
    cxDBCheckBox1: TcxDBCheckBox;
    Label1: TcxLabel;
    cxDBLookupComboBox1: TcxDBLookupComboBox;
    Label6: TcxLabel;
    cxDBLookupComboBox2: TcxDBLookupComboBox;
    Label7: TcxLabel;
    cxDBLookupComboBox3: TcxDBLookupComboBox;
    Label8: TcxLabel;
    cxDBLookupComboBox4: TcxDBLookupComboBox;
    cxDBLookupComboBox5: TcxDBLookupComboBox;
    Label11: TcxLabel;
    cxDBComboBox2: TcxDBComboBox;
    Label10: TcxLabel;
    cxDBComboBox1: TcxDBComboBox;
    Label9: TcxLabel;
    cxDBLookupComboBox6: TcxDBLookupComboBox;
    Label15: TcxLabel;
    cxGroupBox3: TcxGroupBox;
    cxDBMemo1: TcxDBMemo;
    lcds: TClientDataSet;
    lds: TDataSource;
    Label2: TcxLabel;
    cxDBDateEdit1: TcxDBDateEdit;
    cxLabel1: TcxLabel;
    cxDBTimeEdit1: TcxDBTimeEdit;
    OperationTabsheet: TcxTabSheet;
    cxButton1: TcxButton;
    JvFormStorage1: TJvFormStorage;

    procedure PersonANCPregCareCDSBeforePost(DataSet: TDataSet);
    procedure CloseButtonClick(Sender: TObject);
    procedure SaveButtonClick(Sender: TObject);
    procedure DeleteButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure PersonANCPregCareCDSNewRecord(DataSet: TDataSet);
    procedure cxDBLookupComboBox6PropertiesInitPopup(Sender: TObject);
    procedure cxButton1Click(Sender: TObject);
    procedure FormCreate(Sender: TObject);
  private

    FVN: String;

    FOneStopServiceDM: TOneStopServiceDM;

    HOSxPSubModuleOneStopServiceDM: TDataModule;

    FDoctorWorkBenchNurseScreenFrame: TFrame;
    FMedicationOrderFrame: TFrame;

    FPatientInformationFrame: TFrame;

    FHOSxPPCUVisitEntryFrame: TFrame;
    FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame: TFrame;
    FDoctorWorkBenchPhysicalExaminationEntryFrame: TFrame;
    FHOSxPLabOrderHistoryListFrame: TFrame;
    FAppointmentFrame: TFrame;
    FDoctorWorkBenchOperationEntryFrame: TFrame;

    FPersonANCPregCareID: Integer;
    FPersonANCID: Integer;
    procedure InitializeDatamodule;
    procedure SetPersonANCPregCareID(const Value: Integer);
    procedure RefreshData;
    procedure DoSaveData;
    procedure DoDeleteData;
    procedure SetPersonANCID(const Value: Integer);
    { Private declarations }
  public
    { Public declarations }
    property PersonANCID: Integer read FPersonANCID write SetPersonANCID;
    property PersonANCPregCareID: Integer read FPersonANCPregCareID
      write SetPersonANCPregCareID;
    // class procedure DoShowForm(xPersonANCPregCareID: Integer);
    property OneStopServiceDM: TOneStopServiceDM read FOneStopServiceDM;
    class procedure DoShowForm(xPersonANCID, xPersonANCPregCareID: Integer);
  end;

var
  HOSxPPCUAccount2ANCPregcareEntryForm: THOSxPPCUAccount2ANCPregcareEntryForm;

implementation

uses HOSxPDMU, BMSApplicationUtil, HOSxPPCUAccount2DataModuleUnit;

{$R *.dfm}
{ THOSxPSystemSettingIPDBedEntryForm }

procedure THOSxPPCUAccount2ANCPregcareEntryForm.PersonANCPregCareCDSBeforePost
  (DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    DataSet.FieldByName('person_anc_preg_care_id').AsInteger :=
      FPersonANCPregCareID;
  end;

  DataSet.FieldByName('person_anc_id').AsInteger := FPersonANCID;

end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.PersonANCPregCareCDSNewRecord
  (DataSet: TDataSet);
begin
  DataSet.FieldByName('doctor_code').AsString := fdoctor_code;
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.SaveButtonClick
  (Sender: TObject);
begin
  DoSaveData;
  Close;
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.cxButton1Click(Sender: TObject);
var
  s: string;
begin
  s := ShowFindDoctorCodeDialog;
  if s <> '' then
  begin
    if (PersonANCPregCareCDS.State in [dsbrowse]) then
    begin
      if PersonANCPregCareCDS.RecordCount = 0 then
        PersonANCPregCareCDS.Append
      else
        PersonANCPregCareCDS.Edit;
    end;

    PersonANCPregCareCDS.FieldByName('doctor_code').AsString := s;

  end;
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.
  cxDBLookupComboBox6PropertiesInitPopup(Sender: TObject);
begin
  cxDBLookupComboBox6.Properties.ListSource :=
    HOSxPPCUAccount2DataModule.activeDoctorDS;
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.DeleteButtonClick
  (Sender: TObject);
begin
  if messagedlg('Please confirm delete data ?', mtconfirmation, [mbyes, mbno],
    0) <> mryes then
    exit;
  DoDeleteData;
  Close;
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.CloseButtonClick
  (Sender: TObject);
begin
  if getsqldata
    ('select count(*) as cc from person_anc_preg_care where person_anc_preg_care_id = '
    + inttostr(FPersonANCPregCareID)) = 0 then
  begin
    ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoDeleteData', []);
  end;
  Close;
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.LogViewButtonClick
  (Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_preg_care"', inttostr(FPersonANCPregCareID)]);
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.DoDeleteData;
begin
  if (PersonANCPregCareCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCPregCareCDS.cancel;

  end;

  if PersonANCPregCareCDS.RecordCount > 0 then
    PersonANCPregCareCDS.delete;

  if PersonANCPregCareCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCPregCareCDS,
      'select * from person_anc_preg_care where person_anc_preg_care_id = ' +
      inttostr(FPersonANCPregCareID), '', '', '');
    PersonANCPregCareCDS.MergeChangeLog;
  end;
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.DoSaveData;
var
  tc: TClientDataSet;
begin
  if (PersonANCPregCareCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCPregCareCDS.post;

  end;

  if PersonANCPregCareCDS.FieldByName('vn').AsString <> '' then
  begin



    ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSetVstDateTime',
      [PersonANCPregCareCDS.FieldByName('care_date').AsDateTime,
      PersonANCPregCareCDS.FieldByName('care_time').AsDateTime]);

    ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSaveData', []);

    if PersonANCPregCareCDS.FieldByName('vn').AsString <>

      GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN').AsString then
    begin
      PersonANCPregCareCDS.Edit;
      PersonANCPregCareCDS.FieldByName('vn').AsString :=
        GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN').AsString;
      PersonANCPregCareCDS.post;
      FVN := PersonANCPregCareCDS.FieldByName('vn').AsString;
    end;

  end;

  ExecuteRTTIFunction('OPDSignDoctorEntryUnit.TOPDSignDoctorEntryForm',
    'DoShowFormWithVisitCDS', [FVN, nil, OneStopServiceDM.OVstCDS]);

  if assigned(FDoctorWorkBenchNurseScreenFrame) then
    ExecuteRTTIObjectMethod(FDoctorWorkBenchNurseScreenFrame, 'DoSaveData', []);

  if (OneStopServiceDM.OVstCDS.State in [dsinsert, dsedit]) then
    OneStopServiceDM.OVstCDS.post;
  // OneStopServiceDM.OVstCDS.edit;
  // OneStopServiceDM.OVstCDS.FieldByName('cur_dep').asstring :=
  // vartostr(getsqldata('select depcode from kskdepartment where department="' +
  // GetRTTIObjectProperty(FPatientInformationFrame,'CurDep').AsString + '"'));
  // OneStopServiceDM.OVstCDS.Post;

  // CurDep := GetRTTIObjectProperty(FPatientInformationFrame, 'CurDep').AsString;
  // OneStopServiceDM.OVstCDS.edit;
  // if CurDep <> '' then
  // OneStopServiceDM.OVstCDS.FieldByName('cur_dep').AsString := CurDep;
  // OneStopServiceDM.OVstCDS.Post;

  if OneStopServiceDM.OVstCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta(OneStopServiceDM.OVstCDS.delta,
      'select * from ovst where vn = "' + FVN + '"');
  end;

  if (OneStopServiceDM.OVstSeqCDS.State in [dsinsert, dsedit]) then
  begin
    OneStopServiceDM.OVstSeqCDS.post;
  end
  else
  begin
    if OneStopServiceDM.OVstSeqCDS.RecordCount > 0 then
    begin
      OneStopServiceDM.OVstSeqCDS.Edit;
      OneStopServiceDM.OVstSeqCDS.post;
    end;
  end;

  if OneStopServiceDM.OVstSeqCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta(OneStopServiceDM.OVstSeqCDS.delta,
      'select * from ovst_seq where vn = "' + FVN + '"');
  end;

  tc := TClientDataSet.Create(nil);
  tc.data := hosxp_getdataset('select * from opd_dep_queue where vn = "' + FVN +
    '" and depcode="' + fcomputerdepcode + '"');
  if tc.RecordCount > 0 then
  begin
    tc.Edit;

    tc.FieldByName('tx_status').AsString := 'Y';
    tc.FieldByName('check_in').AsString := 'N';
    tc.post;
  end;
  if tc.ChangeCount > 0 then
    hosxp_updatedelta(tc.delta, 'select * from opd_dep_queue where vn = "' + FVN
      + '" and depcode="' + fcomputerdepcode + '"');

  if OneStopServiceDM.OVstCDS.FieldByName('cur_dep').AsString <> '' then

  begin
    tc.data := hosxp_getdataset('select * from opd_dep_queue where vn = "' + FVN
      + '" and depcode="' + OneStopServiceDM.OVstCDS.FieldByName('cur_dep')
      .AsString + '"');

    if tc.RecordCount = 0 then
    begin
      tc.Append;
      repeat
        tc.FieldByName('opd_dep_queue_id').AsInteger :=
          getserialnumber('opd_dep_queue_id');
      until getsqldata
        ('select count(*) as cc from opd_dep_queue where opd_dep_queue_id = ' +
        tc.FieldByName('opd_dep_queue_id').AsString) = 0;

      tc.FieldByName('depcode').AsString := OneStopServiceDM.OVstCDS.FieldByName
        ('cur_dep').AsString;
      tc.FieldByName('vn').AsString := FVN;
    end
    else
    begin
      tc.Edit;
    end;
    tc.FieldByName('queue_datetime').AsDateTime := GetServerDateTime;
    tc.FieldByName('from_depcode').AsString := fcomputerdepcode;
    tc.FieldByName('tx_status').AsString := 'W';
    tc.FieldByName('check_in').AsString := 'N';
    if tc.FieldByName('day_queue_no').AsInteger = 0 then
    begin

      tc.FieldByName('day_queue_no').AsInteger :=
        getserialnumber('day_queue_no_' + formatdatetime('yyyymmdd',
        getsqldata('select vstdate from ovst where vn = "' + FVN + '"')) + '_' +
        tc.FieldByName('depcode').AsString);

    end;

    tc.post;

    if tc.ChangeCount > 0 then
      hosxp_updatedelta(tc.delta, 'select * from opd_dep_queue where vn = "' +
        FVN + '" and depcode="' + OneStopServiceDM.OVstCDS.FieldByName
        ('cur_dep').AsString + '"');
  end;

  tc.Free;

  if assigned(FMedicationOrderFrame) then
    ExecuteRTTIObjectMethod(FMedicationOrderFrame, 'DoSaveData', []);

  if assigned(HOSxPSubModuleOneStopServiceDM) then

    ExecuteRTTIObjectMethod(HOSxPSubModuleOneStopServiceDM,
      'SaveVisitData', []);

  if assigned(FDoctorWorkBenchPhysicalExaminationEntryFrame) then
  begin
    ExecuteRTTIObjectMethod(FDoctorWorkBenchPhysicalExaminationEntryFrame,
      'DoSaveData', []);
  end;

  PersonANCPregCareCDS.Edit;
  try
    PersonANCPregCareCDS.FieldByName('bps').Asfloat :=
      getsqldata('select bps from opdscreen where vn = "' + FVN + '"');
  except
  end;
  try
    PersonANCPregCareCDS.FieldByName('bpd').Asfloat :=
      getsqldata('select bpd from opdscreen where vn = "' + FVN + '"');
  except
  end;
  try
    PersonANCPregCareCDS.FieldByName('rr').AsInteger :=
      getsqldata('select rr from opdscreen where vn = "' + FVN + '"');
  except
  end;

  try
    PersonANCPregCareCDS.FieldByName('hr').AsInteger :=
      getsqldata('select hr from opdscreen where vn = "' + FVN + '"');
  except
  end;

  try
    PersonANCPregCareCDS.FieldByName('pulse').AsInteger :=
      getsqldata('select pulse from opdscreen where vn = "' + FVN + '"');
  except
  end;

  try
    PersonANCPregCareCDS.FieldByName('temperature').Asfloat :=
      getsqldata('select temperature from opdscreen where vn = "' + FVN + '"');
  except
  end;
  // try PersonANCPregCareCDS.fieldbyname('bps').AsInteger:=  getsqldata('select bps from opdscreen where vn = "'+fvn+'"'); except end;
  PersonANCPregCareCDS.post;

  if PersonANCPregCareCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCPregCareCDS,
      'select * from person_anc_preg_care where person_anc_preg_care_id = ' +
      inttostr(FPersonANCPregCareID), '', '', '');
    PersonANCPregCareCDS.MergeChangeLog;
  end;
end;

class procedure THOSxPPCUAccount2ANCPregcareEntryForm.DoShowForm(xPersonANCID,
  xPersonANCPregCareID: Integer);
var
  FHOSxPPCUAccount2ANCPregcareEntryForm: THOSxPPCUAccount2ANCPregcareEntryForm;
begin
  FHOSxPPCUAccount2ANCPregcareEntryForm :=
    THOSxPPCUAccount2ANCPregcareEntryForm.Create(application);
  try
    FHOSxPPCUAccount2ANCPregcareEntryForm.PersonANCID := xPersonANCID;
    FHOSxPPCUAccount2ANCPregcareEntryForm.PersonANCPregCareID :=
      xPersonANCPregCareID;
    FHOSxPPCUAccount2ANCPregcareEntryForm.ShowModal;
  finally
    FHOSxPPCUAccount2ANCPregcareEntryForm.Free;
  end;

end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.FormCreate(Sender: TObject);
begin
  HookDefaultJvFormStorage(self);
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.InitializeDatamodule;
begin
  if assigned(FOneStopServiceDM) then
    exit;

  SafeLoadPackage('HOSxPDoctorWorkBenchPackage.bpl');

  self.FOneStopServiceDM := TOneStopServiceDM.Create(self);

  FOneStopServiceDM.fcheckdiagdoctor := true;

  FDoctorWorkBenchNurseScreenFrame :=
    TFrame(ExecuteRTTIFunction
    ('DoctorWorkBenchNurseScreenFrameUnit.TDoctorWorkBenchNurseScreenFrame',
    'Create', [ScreenGroupBox]).AsObject);
  FDoctorWorkBenchNurseScreenFrame.Align := alclient;
  FDoctorWorkBenchNurseScreenFrame.Parent := ScreenGroupBox;

  // ExecuteRTTIObjectMethod(FDoctorWorkBenchNurseScreenFrame,
  // 'SetTabSheetOnLeft', []);

  SetRTTIObjectProperty(FDoctorWorkBenchNurseScreenFrame, 'OneStopServiceDM',
    self.FOneStopServiceDM);

  SafeLoadPackage('HOSxPSubModulePackage.bpl');

  HOSxPSubModuleOneStopServiceDM :=
    TDataModule(ExecuteRTTIFunction
    ('HOSxPSubModuleOneStopServiceDMU.THOSxPSubModuleOneStopServiceDM',
    'create', [self]).AsObject);

  FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame :=
    TFrame(ExecuteRTTIFunction
    ('HOSxPSubModuleOneStopServiceDiagnosisEntryUnit.THOSxPSubModuleOneStopServiceDiagnosisEntryFrame',
    'create', [DxTabsheet]).AsObject);
  FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame.Parent := DxTabsheet;
  FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame.Align := alclient;

  SetRTTIObjectProperty(FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame,
    'HOSxPSubModuleOneStopServiceDM', HOSxPSubModuleOneStopServiceDM);

  ExecuteRTTIObjectMethod(HOSxPSubModuleOneStopServiceDM,
    'PrepareVisitData', [FVN]);

  FDoctorWorkBenchOperationEntryFrame :=
    TFrame(ExecuteRTTIFunction
    ('DoctorWorkBenchOperationEntryFrameUnit.TDoctorWorkBenchOperationEntryFrame',
    'Create', [OperationTabsheet]).AsObject);
  FDoctorWorkBenchOperationEntryFrame.Parent := OperationTabsheet;
  FDoctorWorkBenchOperationEntryFrame.Align := alclient;
  SetRTTIObjectProperty(FDoctorWorkBenchOperationEntryFrame, 'VN', self.FVN);

  SafeLoadPackage('HOSxPMedicationOrderPackage.bpl');
  FMedicationOrderFrame :=
    TFrame(ExecuteRTTIFunction
    ('HOSxPMedicationOrderFrameUnit.THOSxPMedicationOrderFrame', 'Create',
    [MedicationTabsheet]).AsObject);
  FMedicationOrderFrame.Parent := MedicationTabsheet;
  FMedicationOrderFrame.Align := alclient;
  // if assigned(FTabHostform) then
  // SetRTTIObjectProperty(FMedicationOrderFrame, 'TabHostForm', FTabHostform);

  SetRTTIObjectProperty(FMedicationOrderFrame, 'VN', self.FVN);

  FPatientInformationFrame :=
    TFrame(ExecuteRTTIFunction
    ('PatientInformationType2FrameUnit.TPatientInformationType2Frame', 'create',
    [self]).AsObject);
  FPatientInformationFrame.Parent := PatientInformationDetailGroupBox;
  FPatientInformationFrame.Align := alclient;

  SetRTTIObjectProperty(FPatientInformationFrame, 'HN',
    vartostr(getsqldata('select hn from ovst where vn = "' + FVN + '"')));
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.RefreshData;
var
  avn: string;
  aDateTime:TDateTime;
begin

  if not assigned(FHOSxPPCUVisitEntryFrame) then
  begin
    FHOSxPPCUVisitEntryFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUVisitEntryFrameUnit.THOSxPPCUVisitEntryFrame', 'Create',
      [VisitGroupBox]).AsObject);
    FHOSxPPCUVisitEntryFrame.Parent := VisitGroupBox;
    FHOSxPPCUVisitEntryFrame.Align := alclient;
  end;

  PersonANCPregCareCDS.data :=
    hosxp_getdataset
    ('select * from person_anc_preg_care where person_anc_preg_care_id = ' +
    inttostr(FPersonANCPregCareID));

  if PersonANCCDS.RecordCount > 0 then
  begin
    SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'PersonID',
      PersonANCCDS.FieldByName('person_id').AsInteger);
  end;

  if PersonANCPregCareCDS.RecordCount = 0 then
  begin

     aDateTime :=
    ExecuteRTTIFunction('GetSingleDateTimeFormUnit.TGetSingleDateTimeForm','DoShowForm',[GetServerDateTime]).AsExtended;


    PersonANCPregCareCDS.Append;
    PersonANCPregCareCDS.FieldByName('care_date').AsDateTime := trunc(aDateTime);//GetServerDate;
    PersonANCPregCareCDS.FieldByName('care_time').AsDateTime := frac(adatetime);//GetServerTime;

    if validhncode(GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'HN')
      .AsString) then

      avn := ShowFindVisitDialog(GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame,
        'HN').AsString, 0);

    if validvncode(avn) then
    begin
      PersonANCPregCareCDS.FieldByName('care_date').AsDateTime :=
        getsqldata('select vstdate from ovst where vn = "' + avn + '"');
      PersonANCPregCareCDS.FieldByName('care_time').AsDateTime :=
        getsqldata('select vsttime from ovst where vn = "' + avn + '"');

      SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN', avn);
    end
    else
    begin

      SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitDate',
        PersonANCPregCareCDS.FieldByName('care_date').AsDateTime);
      SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitTime',
        PersonANCPregCareCDS.FieldByName('care_time').AsDateTime);
    end;

    // SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitDate',
    // PersonANCPregCareCDS.FieldByName('care_date').asdatetime);
    // SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitTime',
    // PersonANCPregCareCDS.FieldByName('care_time').asdatetime);
    ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoCheckVisitVN', []);

    ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSaveData', []);

    PersonANCPregCareCDS.FieldByName('vn').AsString :=
      GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN').AsString;
  end
  else
  begin
    SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitDate',
      PersonANCPregCareCDS.FieldByName('care_date').AsDateTime);
    SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitTime',
      PersonANCPregCareCDS.FieldByName('care_time').AsDateTime);

    if validvncode(PersonANCPregCareCDS.FieldByName('vn').AsString) then
    begin
      SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN',
        PersonANCPregCareCDS.FieldByName('vn').AsString);
    end
    else
    begin
      ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoCheckVisitVN', []);
      ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSaveData', []);
      PersonANCPregCareCDS.Edit;
      PersonANCPregCareCDS.FieldByName('vn').AsString :=
        GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN').AsString;

    end;

  end;

  FVN := PersonANCPregCareCDS.FieldByName('vn').AsString;

  InitializeDatamodule;

  FOneStopServiceDM.OPDScreencds.Close;
  FOneStopServiceDM.ovstdiagcds.Close;
  FOneStopServiceDM.opitemrececds.Close;

  FOneStopServiceDM.OVstCDS.data :=
    hosxp_getdataset('select * from ovst where vn = "' + FVN + '"');
  FOneStopServiceDM.OPDScreencds.data :=
    hosxp_getdataset('select * from opdscreen where vn = "' + FVN + '"');
    FOneStopServiceDM.OPDScreenROScds.data :=
    hosxp_getdataset('select * from opdscreen_ros where vn = "' + FVN + '"');

  FOneStopServiceDM.ovstdiagcds.data :=
    hosxp_getdataset('select * from ovstdiag where vn = "' + FVN +
    '" and substring(icd10,1,1) not in ("1","2","3","4","5","6","7","8","9","0")');
  FOneStopServiceDM.ovstdiagopercds.data :=
    hosxp_getdataset('select * from ovstdiag where vn = "' + FVN +
    '"  and substring(icd10,1,1)  in ("1","2","3","4","5","6","7","8","9","0") order by diagtype,icd10');

  // FOneStopServiceDM.opitemrececds.data :=
  // hosxp_getdataset('select * from opitemrece where vn = "' + FVN + '"');

  FOneStopServiceDM.OVstSeqCDS.data :=
    hosxp_getdataset('select * from ovst_seq where vn = "' + FVN + '"');

  SetRTTIObjectProperty(FDoctorWorkBenchNurseScreenFrame, 'VN', FVN);
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.SetPersonANCID
  (const Value: Integer);
begin
  FPersonANCID := Value;
  PersonANCCDS.data := hosxp_getdataset
    ('select * from person_anc where person_anc_id = ' +
    inttostr(FPersonANCID));
end;

procedure THOSxPPCUAccount2ANCPregcareEntryForm.SetPersonANCPregCareID
  (const Value: Integer);
begin
  FPersonANCPregCareID := Value;
  if FPersonANCPregCareID = 0 then
  begin
    repeat
      FPersonANCPregCareID := getserialnumber('person_anc_preg_care_id');
      // GetNewCodeFromTable('person_anc_preg_care', 'person_anc_preg_care_id', '', '001', 3);
    until getsqldata
      ('select count(*) as cc from person_anc_preg_care where person_anc_preg_care_id = '
      + inttostr(FPersonANCPregCareID)) = 0;
  end;
  RefreshData;
end;

end.
